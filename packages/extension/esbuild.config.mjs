import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/**
 * Emits `[watch] build started` / `[watch] build finished` markers that the
 * VSCode `tasks.json` problemMatcher uses to track rebuilds. esbuild prints
 * "build finished" itself but no matching start line.
 */
const watchMarkers = {
  name: "watch-markers",
  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
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
  logLevel: "info",
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
  logLevel: "info",
  loader: {
    ".json": "json",
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
