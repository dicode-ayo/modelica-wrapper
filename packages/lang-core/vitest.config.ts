import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { coverage } from "../../vitest.base.js";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    root: projectRoot,
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    // Baseline measured 2026-11-23 at c945296, together with the
    // `--fail-on-crap` ceiling in package.json. Ratchet per CLAUDE.md.
    coverage: {
      ...coverage,
      thresholds: { statements: 79, branches: 70, functions: 89, lines: 81 },
    },
  },
});
