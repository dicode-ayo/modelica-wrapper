/**
 * Drag-and-drop contract for library class rows.
 *
 * The library tree writes a `{ className }` payload onto the `DataTransfer`
 * under {@link LIBRARY_TREE_DRAG_FORMAT}; drop targets (the diagram canvas)
 * read it back. Kept side-effect-free so a drop target can import the format
 * without pulling in the tree component's virtualizer / headless-tree deps.
 */

/** `DataTransfer` type carrying a `{ className }` payload for a dragged row. */
export const LIBRARY_TREE_DRAG_FORMAT = "application/x-om-library-class";

/** Serialise the drag payload for a class row. */
export function serializeLibraryDrag(className: string): string {
  return JSON.stringify({ className });
}

/**
 * Parse a library drag payload back to its class name. Returns `null` when the
 * payload is absent, not valid JSON, or doesn't carry a non-empty `className`,
 * so a drop target can treat every malformed case as "not our drag".
 */
export function parseLibraryDrag(raw: string): string | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const className = (parsed as Record<string, unknown>).className;
  if (typeof className !== "string" || className === "") return null;
  return className;
}
