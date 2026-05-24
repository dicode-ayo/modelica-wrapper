import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/**
 * The language front-end (`src/language/parse.ts`) runs the tree-sitter
 * grammar as WASM in-process via `web-tree-sitter`. Two `.wasm` files must
 * sit next to the bundle at runtime so the extension can load them by
 * absolute path (esbuild can't inline a WASM the way it can a `.css`):
 *
 *   1. `tree-sitter.wasm`           — the web-tree-sitter runtime (Emscripten
 *      core), shipped by the npm package; located via `require.resolve`.
 *   2. `tree-sitter-modelica.wasm`  — the vendored OpenModelica grammar
 *      (see `grammar/README.md` for provenance).
 *
 * Both names are re-exported as `RUNTIME_WASM_FILENAME` /
 * `GRAMMAR_WASM_FILENAME` from `src/language/parse.ts`; keep them in sync.
 */
const RUNTIME_WASM_FILENAME = "tree-sitter.wasm";
const GRAMMAR_WASM_FILENAME = "tree-sitter-modelica.wasm";

/**
 * Expected SHA-256 of the vendored grammar WASM. This is the supply-chain
 * invariant recorded in `grammar/README.md` (OpenModelica/tree-sitter-modelica
 * v0.2.2); keep the two in sync. The runtime `tree-sitter.wasm` comes from the
 * npm package and is already integrity-pinned by the lockfile, so only the
 * vendored binary carries a hash here.
 */
const GRAMMAR_WASM_SHA256 =
  "fb9e1f0c33288fc301f50bff88bad28ebf2f79365b23482855a1a9e756c78e56";

const wasmAssets = [
  {
    from: require.resolve(`web-tree-sitter/${RUNTIME_WASM_FILENAME}`),
    to: RUNTIME_WASM_FILENAME,
  },
  {
    from: resolve(here, "grammar", GRAMMAR_WASM_FILENAME),
    to: GRAMMAR_WASM_FILENAME,
    sha256: GRAMMAR_WASM_SHA256,
  },
];

/**
 * Copies the language WASM assets into `out/` on every (re)build so they
 * ship beside `extension.js`. esbuild does not bundle them — they're loaded
 * at runtime by path — so a plain copy on `onEnd` is the right tool.
 *
 * Assets with a pinned `sha256` are verified before the copy: the build fails
 * (`onEnd` errors propagate) if the source bytes don't match, turning the
 * README's documented hash into an enforced invariant that catches a tampered
 * or wrong-version vendored binary instead of silently shipping it.
 */
const copyWasm = {
  name: "copy-wasm",
  setup(build) {
    build.onEnd(async () => {
      const outDir = resolve(here, "out");
      await mkdir(outDir, { recursive: true });
      await Promise.all(
        wasmAssets.map(async (a) => {
          if (a.sha256) await verifySha256(a.from, a.sha256);
          await copyFile(a.from, join(outDir, a.to));
        }),
      );
    });
  },
};

/**
 * Throw if the SHA-256 of `filePath` doesn't equal `expected`. Used by
 * {@link copyWasm} to gate the vendored grammar copy on its recorded hash.
 */
async function verifySha256(filePath, expected) {
  const actual = createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
  if (actual !== expected) {
    throw new Error(
      `WASM integrity check failed for ${filePath}\n` +
        `  expected SHA-256: ${expected}\n` +
        `  actual SHA-256:   ${actual}\n` +
        `If you intentionally updated the grammar, bump GRAMMAR_WASM_SHA256 ` +
        `in esbuild.config.mjs and the SHA in grammar/README.md together.`,
    );
  }
}

/**
 * Emits `[watch] build started` / `[watch] build finished` markers that the
 * VSCode `tasks.json` problemMatcher uses to track rebuilds. We emit both
 * markers ourselves (instead of relying on esbuild's own "build finished,
 * watching for changes..." line) and reference-count across the two parallel
 * contexts so VSCode sees exactly one started/finished pair per rebuild —
 * otherwise the EDH launch can race the second context's output and hang.
 */
let activeBuilds = 0;
const watchMarkers = {
  name: "watch-markers",
  setup(build) {
    build.onStart(() => {
      if (activeBuilds === 0) console.log("[watch] build started");
      activeBuilds++;
    });
    build.onEnd(() => {
      activeBuilds--;
      if (activeBuilds === 0) console.log("[watch] build finished");
    });
  },
};

/**
 * Three-bundle build:
 *
 *   1. extension.js     — Node.js host code (CommonJS, externals for
 *      `vscode` + `zeromq`).
 *
 *   2. webview.js       — browser bundle of the diagram-ui custom
 *      elements, loaded by the webview HTML to mount
 *      `<om-graphical-layout>` against the layout posted from the
 *      extension. Babylon + Lit get tree-shaken into one IIFE.
 *
 *   3. postprocessing.js — browser bundle of the postprocessing webview
 *      (`<om-result-view-root>`), loaded by the `*.omresults` custom
 *      editor. No Babylon — Lit + ECharts (later) only.
 */

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  // `web-tree-sitter` ships an Emscripten glue module that loads its WASM by
  // path at runtime; bundling it through esbuild breaks that, so keep it
  // external and let Node resolve it from node_modules at load time.
  external: ["vscode", "zeromq", "web-tree-sitter"],
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  logLevel: watch ? "warning" : "info",
  plugins: watch ? [watchMarkers, copyWasm] : [copyWasm],
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: ["src/webview/webview-entry.ts"],
  bundle: true,
  outfile: "out/webview.js",
  platform: "browser",
  target: "es2022",
  format: "iife",
  sourcemap: true,
  logLevel: watch ? "warning" : "info",
  // The default tsconfig.json excludes the webview entry and doesn't set
  // experimentalDecorators; without this override esbuild emits TC39
  // stage-3 decorators and Lit throws "Unsupported decorator location".
  tsconfig: "tsconfig.webview.json",
  loader: {
    ".json": "json",
    // Web Awesome ships its theme + native form-control reset as
    // plain CSS files; importing them from JS lets esbuild collect
    // and emit a sibling `webview.css` next to `webview.js`. The
    // webview HTML in `diagram/panel.ts` <link>s to it directly.
    ".css": "css",
  },
  // Stamped into the bundle so the runtime can prove which build it is —
  // changes only on rebuild, not on webview reload.
  define: {
    __WEBVIEW_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: watch ? [watchMarkers] : [],
};

/**
 * 3. postprocessing.js — browser bundle of the standalone postprocessing
 *    webview (`<om-result-view-root>`), loaded by the `*.omresults` custom
 *    editor. Same shape as the diagram webview; its `import "*.css"` (Web
 *    Awesome theme + bridge, via ui-common) is collected into a sibling
 *    `postprocessing.css`.
 *
 * @type {import('esbuild').BuildOptions}
 */
const postprocessingConfig = {
  ...webviewConfig,
  entryPoints: ["src/webview/postprocessing-entry.ts"],
  outfile: "out/postprocessing.js",
};

if (watch) {
  const a = await esbuild.context(extensionConfig);
  const b = await esbuild.context(webviewConfig);
  const c = await esbuild.context(postprocessingConfig);
  await Promise.all([a.watch(), b.watch(), c.watch()]);
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(webviewConfig),
    esbuild.build(postprocessingConfig),
  ]);
}
