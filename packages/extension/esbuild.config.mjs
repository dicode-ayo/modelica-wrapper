import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

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
 * Two-bundle build:
 *
 *   1. extension.js  — Node.js host code (CommonJS, externals for
 *      `vscode` + `zeromq`).
 *
 *   2. webview.js    — browser bundle of the diagram-ui custom
 *      elements, loaded by the webview HTML to mount
 *      `<om-graphical-layout>` against the layout posted from the
 *      extension. Babylon + Lit get tree-shaken into one IIFE.
 */

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  external: ["vscode", "zeromq"],
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  logLevel: watch ? "warning" : "info",
  plugins: watch ? [watchMarkers] : [],
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

if (watch) {
  const a = await esbuild.context(extensionConfig);
  const b = await esbuild.context(webviewConfig);
  await Promise.all([a.watch(), b.watch()]);
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(webviewConfig),
  ]);
}
