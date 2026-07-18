/**
 * Shared `ContextKeys` builder for tests and stories. Mirrors
 * `library-tree/library-tree.fixtures.ts` — kept beside the type so every
 * field added to `ContextKeys` only needs threading through here.
 */

import type { ContextKeys } from "./context-keys.js";

export function makeContextKeys(
  overrides: Partial<ContextKeys> = {},
): ContextKeys {
  return {
    mode: "select",
    gesture: "idle",
    readonly: false,
    selectionCount: 0,
    selectionKind: "none",
    viewLayer: "diagram",
    hasClipboard: false,
    vertexTarget: false,
    polySelection: false,
    ...overrides,
  };
}
