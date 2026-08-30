/**
 * Coverage settings every package's `vitest.config.ts` spreads into its `test`
 * block. Central for the same reason `tsconfig.base.json` is: eight copies of
 * one policy is eight chances for it to drift.
 *
 * Istanbul rather than v8. Per-function coverage is read from Istanbul's
 * `fnMap` / `f` counters; v8 attributes hits to byte ranges and its converted
 * output does not reproduce those faithfully, so a per-function consumer (the
 * CRAP report) reads wrong numbers off it.
 *
 * The `json` reporter is what writes `coverage/coverage-final.json` — the
 * input every CRAP tool takes.
 */
export const coverage = {
  provider: "istanbul",
  reportsDirectory: "coverage",
  reporter: ["text-summary", "json"],
  include: ["src/**/*.ts"],
  exclude: [
    "src/**/*.test.ts",
    "src/**/*.d.ts",
    "src/**/*.fixture.ts",
    "src/**/*.fixtures.ts",
    "src/**/*.stories.ts",
    "src/index.ts",
  ],
} as const;
