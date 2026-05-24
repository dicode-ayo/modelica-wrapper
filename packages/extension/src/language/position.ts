/**
 * Position/offset helpers for the tree-sitter layer.
 *
 * ## Offset unit: UTF-16 code units (verified)
 *
 * `web-tree-sitter`'s *C* API is UTF-8 byte-native (hence the `.d.ts` wording
 * "Parse a slice of UTF8 text" / "the byte index where this node starts").
 * However, when the parser is driven through the **JavaScript string input
 * path** — `parser.parse(string)`, which is what `parse.ts` and the tests use —
 * the binding transparently transcodes and exposes **UTF-16 code-unit** offsets
 * and columns, to line up with JavaScript `String.length`:
 *
 * - `Node.startIndex` / `descendantForIndex` are UTF-16 code-unit offsets
 *   (e.g. an `IDENT` after a multi-byte comment reports its UTF-16 offset, not
 *   its byte offset — confirmed by `position.test.ts`).
 * - `Point.column` is a UTF-16 code-unit column (an identifier after an astral
 *   `😀` reports column 9, i.e. counting the surrogate pair as 2 — not 8).
 * - `Tree.edit` expects the same UTF-16 units; a UTF-16-based edit + reparse
 *   stays in sync with a fresh parse.
 *
 * This is exactly the unit VSCode already speaks: `document.offsetAt(position)`,
 * `TextDocumentContentChangeEvent.rangeOffset` / `.rangeLength`,
 * `change.text.length` and `Position.character` are all UTF-16 code-unit counts.
 * So **no byte conversion is needed** — VSCode offsets feed tree-sitter
 * directly. The one subtlety is that "advance a column by inserted text" must
 * count UTF-16 code *units*, not code *points* (a `for…of` over a string yields
 * code points and miscounts astral characters by one per surrogate pair); that
 * is what {@link advancePointUtf16} handles.
 */

import type { Point } from "web-tree-sitter";

/**
 * The tree-sitter {@link Point} reached by inserting `text` at {@link start},
 * counting columns in **UTF-16 code units** (tree-sitter's string-path unit).
 * A `\n` advances the row and resets the column; every other UTF-16 code unit
 * advances the column by one.
 *
 * Using `text.length` of the trailing line is the correct UTF-16-unit count and
 * naturally handles astral characters (a surrogate pair counts as 2 units),
 * unlike a `for…of` code-point loop.
 */
export function advancePointUtf16(start: Point, text: string): Point {
  const lastNewline = text.lastIndexOf("\n");
  if (lastNewline === -1) {
    return { row: start.row, column: start.column + text.length };
  }
  let rows = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") rows++;
  }
  // The trailing line's length in UTF-16 units (everything after the last \n).
  return { row: start.row + rows, column: text.length - lastNewline - 1 };
}
