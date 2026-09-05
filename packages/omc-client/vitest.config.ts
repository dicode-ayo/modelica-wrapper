import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { coverage } from "../../vitest.base.js";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    root: projectRoot,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    coverage,
  },
});
