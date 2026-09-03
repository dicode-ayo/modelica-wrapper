import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { coverage } from "../../vitest.base.js";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
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
    root: projectRoot,
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    coverage,
  },
});
