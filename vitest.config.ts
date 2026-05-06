import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Anchor `root` to this file's directory so vitest finds tests regardless of
// the cwd it is invoked from. The VSCode Vitest extension launches vitest
// with cwd set to the test file's directory; without this, the relative
// `include` glob resolves against that cwd and finds nothing.
const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    root: projectRoot,
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});
