import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

import { coverage } from "../../vitest.base.js";

const projectRoot = dirname(fileURLToPath(import.meta.url));

// The Lit webview entries only reach the browser through esbuild's webview
// bundle. Their tests run in happy-dom, compiled against the same
// `tsconfig.webview.json` that bundle uses: the default `tsconfig.json` leaves
// decorators as TC39 stage-3 syntax, which Lit's legacy decorators reject.
// `src/webview/entry-tests.test.ts` keeps every decorated file covered here.
const WEBVIEW_ENTRY_TESTS = "src/webview/*-entry.test.ts";

export default defineConfig({
  test: {
    root: projectRoot,
    // Floors sit at the measured baseline, paired with the `--fail-on-crap`
    // ceiling in `package.json`. Ratchet per CLAUDE.md.
    coverage: {
      ...coverage,
      thresholds: { statements: 79, branches: 76, functions: 78, lines: 80 },
    },
    projects: [
      {
        // `vscode` is provided by the extension host at runtime and not on npm.
        // For pure-logic unit tests, alias it to a minimal in-repo stub so tests
        // that only need a few VSCode types (Range, Diagnostic, Uri, …) can run
        // in plain Node without spinning up an extension host.
        resolve: {
          alias: {
            vscode: resolve(projectRoot, "test-support/vscode-mock.ts"),
          },
        },
        test: {
          name: "unit",
          root: projectRoot,
          include: ["src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, WEBVIEW_ENTRY_TESTS],
          environment: "node",
          testTimeout: 30_000,
        },
      },
      {
        oxc: { tsconfig: resolve(projectRoot, "tsconfig.webview.json") },
        // Web Awesome's form controls read `ElementInternals`, which happy-dom
        // does not implement, so connecting one rejects. These tests pin the
        // bridge between host messages and the rendered tree, not the controls.
        resolve: {
          alias: [
            {
              find: /^@awesome\.me\/webawesome\/dist\/components\/.*$/,
              replacement: resolve(projectRoot, "test-support/inert-module.ts"),
            },
          ],
        },
        define: { __WEBVIEW_BUILD_TIME__: JSON.stringify("test") },
        test: {
          name: "webview",
          root: projectRoot,
          include: [WEBVIEW_ENTRY_TESTS],
          environment: "happy-dom",
          testTimeout: 10_000,
        },
      },
    ],
  },
});
