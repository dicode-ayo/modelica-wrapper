/**
 * `../logger.js`'s `vi.mock` replacement, shared by every extension unit test
 * that mocks the logger instead of exercising the real `OutputChannel`. Kept
 * in sync with `logger.ts`'s actual exported surface by hand — there is only
 * one copy to update now.
 */

import { vi } from "vitest";

export const log = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  show: vi.fn(),
  dispose: vi.fn(),
};
