/**
 * Shared OMC-availability gate for `*.integration.test.ts` files. Not a
 * cross-package import of `@dicode/omc-client`'s own copy (`test/fixtures.ts`)
 * — that package's `test/` directory isn't part of its published exports, so
 * each package keeps its own copy of this small gate rather than reaching
 * across the workspace boundary for it.
 */

import { execSync } from "node:child_process";

import { describe } from "vitest";

/**
 * Whether an integration test suite should run against a live OMC: opt out
 * with `OMC_INTEGRATION=0`, opt in with `OMC_INTEGRATION=1` or `OMC_PATH`,
 * otherwise auto-detect `omc` on `PATH`.
 */
export function shouldRun(): boolean {
  const flag = process.env.OMC_INTEGRATION;
  if (flag === "0") return false;
  if (flag === "1") return true;
  if (process.env.OMC_PATH && process.env.OMC_PATH.length > 0) return true;
  try {
    execSync(process.platform === "win32" ? "where omc" : "command -v omc", {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/** `describe` when {@link shouldRun} is true, `describe.skip` otherwise. */
export const describeIf = shouldRun() ? describe : describe.skip;
