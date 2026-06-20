/**
 * The selection a right-click should produce before the context menu opens, so
 * the menu acts on what was actually clicked:
 *   - empty space (`key === null`) → clear the selection;
 *   - an unselected entity → select just that one;
 *   - an already-selected entity → keep the (possibly multi-) selection.
 *
 * Returns the new key list, or `null` to leave the selection unchanged (so a
 * no-op right-click doesn't churn a selection-change event).
 */
export function nextContextSelection(
  current: ReadonlySet<string>,
  key: string | null,
): string[] | null {
  if (key === null) {
    return current.size === 0 ? null : [];
  }
  return current.has(key) ? null : [key];
}
