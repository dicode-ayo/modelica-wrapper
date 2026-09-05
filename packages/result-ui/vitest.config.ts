import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { coverage } from "../../vitest.base.js";

const projectRoot = dirname(fileURLToPath(import.meta.url));

/**
 * happy-dom is the default test environment so Lit can register custom
 * elements and we can mount `<om-*>` elements in unit tests (the cards UI
 * lands in a later PR; pure helpers like the variable tree don't need it but
 * share the same config).
 */
export default defineConfig({
  test: {
    root: projectRoot,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "happy-dom",
    testTimeout: 10_000,
    coverage,
  },
});
