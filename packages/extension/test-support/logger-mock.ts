import { vi } from "vitest";

import type { log as realLog } from "../src/logger.js";

/**
 * `vi.mock` replacement for `src/logger.js` in unit tests that don't exercise
 * the real `OutputChannel`. The `satisfies` clause fails `tsc` if `logger.ts`
 * grows, drops or renames a method.
 */
export const log = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  show: vi.fn(),
  dispose: vi.fn(),
} satisfies Record<keyof typeof realLog, unknown>;
