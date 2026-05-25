// Copies native / non-bundlable runtime dependencies (and their full
// production dependency closure) into out/node_modules so they ship inside the
// .vsix and `require()` resolves them in the installed extension.
//
// esbuild bundles the extension into out/extension.js but leaves these deps
// `external` (see esbuild.config.mjs): they load a platform .node addon by a
// path computed at runtime, which breaks if bundled. zeromq, for example,
// resolves cmake-ts's loader and then `require`s the matching prebuilt binary
// from its own build/ dir — so the whole package tree has to sit beside the
// bundle untouched.
//
// This only runs at *package* time (see the `package` script). Local dev (F5)
// resolves these from the workspace node_modules as usual, so out/node_modules
// is a packaging artifact, not a build one.

import { cp, mkdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(here, "..");
const outNodeModules = join(extensionRoot, "out", "node_modules");

// Deps esbuild leaves external and that must be shipped whole. Their
// dependency closure is copied too (e.g. zeromq → cmake-ts), so this list only
// needs the direct externals — keep it in sync with `external` in
// esbuild.config.mjs.
const EXTERNAL_RUNTIME_DEPS = ["zeromq"];

/** Locate a package's root dir, tolerating `exports` maps that hide package.json. */
function packageRoot(fromRequire, name) {
  try {
    return dirname(fromRequire.resolve(`${name}/package.json`));
  } catch {
    let dir = dirname(fromRequire.resolve(name));
    for (;;) {
      const manifest = join(dir, "package.json");
      if (
        existsSync(manifest) &&
        JSON.parse(readFileSync(manifest, "utf8")).name === name
      ) {
        return dir;
      }
      const parent = dirname(dir);
      if (parent === dir) throw new Error(`Cannot locate package root for "${name}"`);
      dir = parent;
    }
  }
}

async function copyClosure(name, fromContext, copied) {
  if (copied.has(name)) return;
  copied.add(name);

  const fromRequire = createRequire(fromContext);
  const root = packageRoot(fromRequire, name);

  const dest = join(outNodeModules, name);
  await mkdir(dirname(dest), { recursive: true }); // handles @scoped names
  await cp(root, dest, { recursive: true, dereference: true });

  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    // Resolve each dependency from *this* package's context (pnpm-correct).
    await copyClosure(dep, join(root, "package.json"), copied);
  }
}

await mkdir(outNodeModules, { recursive: true });
const copied = new Set();
for (const dep of EXTERNAL_RUNTIME_DEPS) {
  await copyClosure(dep, import.meta.url, copied);
}
console.log(`Bundled native runtime deps into out/node_modules: ${[...copied].sort().join(", ")}`);
