#!/usr/bin/env node
/**
 * Packages the extension as a .vsix outside the pnpm workspace.
 *
 * `vsce package` determines which `node_modules` to ship by shelling out to
 * `npm ls`, which chokes on pnpm's symlinked/virtual-store layout (and on the
 * workspace's `workspace:*` devDependencies, none of which are installable by
 * plain npm). So this script stages a throwaway, npm-only copy of just what
 * the packaged extension needs and runs `vsce` there instead of in the repo.
 *
 * `zeromq` and `web-tree-sitter` are the only runtime dependencies esbuild
 * doesn't bundle (see the `external` list in esbuild.config.mjs) — everything
 * else ends up inlined into out/*.js. Both need their real npm dependency
 * closure on disk (zeromq's own native-addon loader pulls in `cmake-ts` and
 * `node-addon-api` at require time), so the stage directory gets a plain
 * `npm install` rather than a hand-picked copy of node_modules — that closure
 * isn't hardcoded here and self-heals across dependency bumps.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function removeSourceMaps(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      removeSourceMaps(path);
    } else if (entry.name.endsWith(".map")) {
      unlinkSync(path);
    }
  }
}

const require = createRequire(import.meta.url);
const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const stageDir = join(extensionRoot, ".vsix-stage");
const outFile = join(extensionRoot, "modelica-wrapper.vsix");

const RUNTIME_DEPENDENCIES = ["zeromq", "web-tree-sitter"];
const STATIC_ENTRIES = [
  "out",
  "syntaxes",
  "language-configuration.json",
  "README.md",
  "CHANGELOG.md",
];

if (!existsSync(join(extensionRoot, "out", "extension.js"))) {
  console.error("out/extension.js not found — run `pnpm build` first.");
  process.exit(1);
}

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

const pkg = JSON.parse(
  readFileSync(join(extensionRoot, "package.json"), "utf8"),
);
writeFileSync(
  join(stageDir, "package.json"),
  JSON.stringify(
    {
      name: pkg.name,
      displayName: pkg.displayName,
      description: pkg.description,
      version: pkg.version,
      publisher: pkg.publisher,
      engines: pkg.engines,
      categories: pkg.categories,
      main: pkg.main,
      activationEvents: pkg.activationEvents,
      contributes: pkg.contributes,
      dependencies: Object.fromEntries(
        RUNTIME_DEPENDENCIES.map((name) => [name, pkg.dependencies[name]]),
      ),
    },
    null,
    2,
  ),
);

for (const entry of STATIC_ENTRIES) {
  const from = join(extensionRoot, entry);
  if (existsSync(from)) {
    cpSync(from, join(stageDir, entry), { recursive: true });
  }
}
// Dev-only; no need to ship them in the release artifact.
removeSourceMaps(join(stageDir, "out"));

execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
  cwd: stageDir,
  stdio: "inherit",
});

const vsceBin = require.resolve("@vscode/vsce/vsce");
execFileSync(
  process.execPath,
  [vsceBin, "package", "--allow-missing-repository", "-o", outFile],
  {
    cwd: stageDir,
    stdio: "inherit",
  },
);

console.log(`Packaged ${outFile}`);
