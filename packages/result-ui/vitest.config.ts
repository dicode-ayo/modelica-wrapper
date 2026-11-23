import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { coverage } from "../../vitest.base.js";

const projectRoot = dirname(fileURLToPath(import.meta.url));

/**
 * happy-dom is the default test environment so Lit can register custom
 * elements and we can mount `<om-*>` elements in unit tests.
 */
export default defineConfig({
  test: {
    root: projectRoot,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "happy-dom",
    testTimeout: 10_000,
    // Floors sit at the measured baseline, paired with the `--fail-on-crap`
    // ceiling in `package.json`. Ratchet per CLAUDE.md.
    coverage: {
      ...coverage,
      thresholds: { statements: 64, branches: 49, functions: 56, lines: 67 },
    },
  },
});
