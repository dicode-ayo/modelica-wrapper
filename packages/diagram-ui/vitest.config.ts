import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { coverage } from "../../vitest.base.js";

const projectRoot = dirname(fileURLToPath(import.meta.url));

/**
 * happy-dom is used as the default test environment so Lit can register
 * custom elements and we can mount `<om-*>` elements in unit tests.
 * Babylon's `NullEngine` then drives the scene without a real WebGL
 * context, which keeps tests headless-friendly.
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
