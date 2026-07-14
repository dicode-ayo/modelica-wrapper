import { createRequire } from "node:module";
import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

import {
  GRAMMAR_WASM_SHA256,
  checkGrammarSha256,
} from "./grammar/grammar-source.mjs";

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
 *   2. `tree-sitter-modelica.wasm`  — the OpenModelica grammar, fetched on
 *      install by `scripts/fetch-grammar-wasm.mjs` into `grammar/` (see
 *      `grammar/README.md` for provenance); not committed.
 *
 * Both names are re-exported as `RUNTIME_WASM_FILENAME` /
 * `GRAMMAR_WASM_FILENAME` from `src/language/parse.ts`; keep them in sync.
 *
 * The grammar's integrity check (`checkGrammarSha256`) and expected hash
 * (`GRAMMAR_WASM_SHA256`) are imported from `grammar/grammar-source.mjs` — the
 * single source of truth shared with the fetch script — so the supply-chain pin
 * (and the routine that verifies it) live in exactly one place. The runtime
 * `tree-sitter.wasm` comes from the npm package and is already integrity-pinned
 * by the lockfile, so only the grammar is verified here.
 */
const RUNTIME_WASM_FILENAME = "tree-sitter.wasm";
const GRAMMAR_WASM_FILENAME = "tree-sitter-modelica.wasm";

const wasmAssets = [
  {
    from: require.resolve(`web-tree-sitter/${RUNTIME_WASM_FILENAME}`),
    to: RUNTIME_WASM_FILENAME,
  },
  {
    from: resolve(here, "grammar", GRAMMAR_WASM_FILENAME),
    to: GRAMMAR_WASM_FILENAME,
    verify: true,
  },
];

/**
 * Copies the language WASM assets into `out/` on every (re)build so they
 * ship beside `extension.js`. esbuild does not bundle them — they're loaded
 * at runtime by path — so a plain copy on `onEnd` is the right tool.
 *
 * Assets with a pinned `sha256` are verified before the copy: the build fails
 * (`onEnd` errors propagate) if the source bytes don't match, turning the
 * pinned hash into an enforced invariant that catches a tampered or
 * wrong-version binary instead of silently shipping it.
 *
 * The grammar WASM is an install artifact (fetched, not committed), so the
 * source file can legitimately be absent on a fresh checkout that skipped
 * install — that case gets a dedicated "run pnpm install" error rather than a
 * raw ENOENT.
 */
const copyWasm = {
  name: "copy-wasm",
  setup(build) {
    build.onEnd(async () => {
      const outDir = resolve(here, "out");
      await mkdir(outDir, { recursive: true });
      await Promise.all(
        wasmAssets.map(async (a) => {
          if (a.verify) {
            await ensureGrammarPresent(a.from);
            await verifyGrammarWasm(a.from);
          }
          await copyFile(a.from, join(outDir, a.to));
        }),
      );
    });
  },
};

/**
 * Fail with an actionable message if the (now install-fetched) grammar WASM
 * isn't on disk — the build can't conjure it, and a fresh checkout that never
 * ran install won't have it. Points the user at the fetch step.
 */
async function ensureGrammarPresent(filePath) {
  try {
    await access(filePath);
  } catch {
    throw new Error(
      `Grammar WASM not found at ${filePath}\n` +
        `It is fetched on install, not committed. Run \`pnpm install\` to ` +
        `download it (or \`node scripts/fetch-grammar-wasm.mjs\` directly), ` +
        `then rebuild. Offline installs must pre-place the file — see ` +
        `grammar/README.md.`,
    );
  }
}

/**
 * Throw if the grammar WASM at `filePath` doesn't match the pinned hash. Used by
 * {@link copyWasm} to gate the grammar copy. Shares {@link checkGrammarSha256}
 * with the install-time fetch so the two integrity gates can't drift.
 */
async function verifyGrammarWasm(filePath) {
  const { ok, actual } = checkGrammarSha256(await readFile(filePath));
  if (!ok) {
    throw new Error(
      `WASM integrity check failed for ${filePath}\n` +
        `  expected SHA-256: ${GRAMMAR_WASM_SHA256}\n` +
        `  actual SHA-256:   ${actual}\n` +
        `If you intentionally updated the grammar, bump the pin in ` +
        `grammar/grammar-source.mjs and the SHA in grammar/README.md together.`,
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
 * Bundle build:
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
 *
 * The library sidebar and documentation webviews add two more browser
 * bundles, defined below.
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
  plugins: [copyWasm, ...(watch ? [watchMarkers] : [])],
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

/**
 * 4. library-view.js — browser bundle of the library sidebar webview view
 *    (`<om-library-view-root>`), loaded by `tree/library-webview-provider.ts`.
 *    Same shape as the diagram webview; it renders `<om-library-tree>` with
 *    adopted stylesheets only, so no sibling `.css` is emitted.
 *
 * @type {import('esbuild').BuildOptions}
 */
const libraryViewConfig = {
  ...webviewConfig,
  entryPoints: ["src/webview/library-view-entry.ts"],
  outfile: "out/library-view.js",
};

/**
 * 5. documentation.js — browser bundle of the documentation webview
 *    (`<om-documentation-root>`), loaded by the `modelica.documentation` custom
 *    editor. Same shape as the diagram webview; it renders with adopted
 *    stylesheets only, so no sibling `.css` is emitted.
 *
 * @type {import('esbuild').BuildOptions}
 */
const documentationConfig = {
  ...webviewConfig,
  entryPoints: ["src/webview/documentation-entry.ts"],
  outfile: "out/documentation.js",
};

if (watch) {
  const a = await esbuild.context(extensionConfig);
  const b = await esbuild.context(webviewConfig);
  const c = await esbuild.context(postprocessingConfig);
  const d = await esbuild.context(libraryViewConfig);
  const e = await esbuild.context(documentationConfig);
  await Promise.all([a.watch(), b.watch(), c.watch(), d.watch(), e.watch()]);
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(webviewConfig),
    esbuild.build(postprocessingConfig),
    esbuild.build(libraryViewConfig),
    esbuild.build(documentationConfig),
  ]);
}
