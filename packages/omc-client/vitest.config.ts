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
    // Floors sit at the measured baseline, paired with the `--fail-on-crap`
    // ceiling in `package.json`. Ratchet per CLAUDE.md.
    coverage: {
      ...coverage,
      thresholds: { statements: 74, branches: 68, functions: 53, lines: 75 },
    },
  },
});
