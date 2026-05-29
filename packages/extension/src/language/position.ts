/**
 * Position/offset helpers for the tree-sitter and OMC coordinate layers.
 *
 * Tree-sitter's `.d.ts` says "UTF-8 byte index", but the JavaScript string
 * input path (`parser.parse(string)`) transcodes — `Node.startIndex`,
 * `Point.column`, and `Tree.edit` all use UTF-16 code units, matching VSCode
 * (`Position.character`, `change.text.length`, `document.offsetAt`). No byte
 * conversion needed; only "advance a column by inserted text" must count code
 * *units*, not code *points* (a `for…of` loop miscounts astral characters by
 * one per surrogate pair) — see {@link advancePointUtf16}.
 */

import type { Point } from "web-tree-sitter";

/** 0-based editor position, vscode-free for purity. */
export interface ZeroBasedPosition {
  readonly line: number;
  /** UTF-16 code units, matching `vscode.Position.character`. */
  readonly character: number;
}

/** 0-based, half-open `[start, end)` range. */
export interface ZeroBasedRange {
  readonly start: ZeroBasedPosition;
  readonly end: ZeroBasedPosition;
}

/**
 * OMC reports source locations 1-based for both line and column; VSCode is
 * 0-based. This is the single shift point used by both `resolve.ts` and
 * `diagnostics/from-omc.ts`.
 */
export const OMC_POSITION_BASE = 1;

/**
 * Convert OMC 1-based `(line, column)` to 0-based. OMC can report `0` for a
 * missing/synthetic location; the result is clamped to `0` so callers don't
 * construct a negative `vscode.Position`.
 */
export function omcToVscodePosition(
  line: number,
  column: number,
): ZeroBasedPosition {
  return {
    line: Math.max(0, line - OMC_POSITION_BASE),
    character: Math.max(0, column - OMC_POSITION_BASE),
  };
}

/**
 * Convert an OMC `getClassInformation` start/end span to a 0-based range.
 *
 * `getClassInformation` end coordinates are **inclusive** of the last
 * character; `vscode.Range` end is **exclusive**, so the end column is stepped
 * by one. `columnNumberEnd === 0` is OMC's "no end column" marker and stays
 * collapsed to 0.
 *
 * Diagnostics (`getMessagesStringInternal`) use a different convention —
 * exclusive end columns. That path goes through `diagnostics/from-omc.ts`'s
 * `rangeFromInfo`, which shares `omcToVscodePosition` but applies its own
 * end-column rule. Do not factor the two further without reconfirming both
 * conventions against live OMC.
 */
export function omcRangeToVscodeRange(span: {
  lineNumberStart: number;
  columnNumberStart: number;
  lineNumberEnd: number;
  columnNumberEnd: number;
}): ZeroBasedRange {
  const start = omcToVscodePosition(span.lineNumberStart, span.columnNumberStart);
  const end = omcToVscodePosition(span.lineNumberEnd, span.columnNumberEnd);
  const endCharacter = span.columnNumberEnd > 0 ? end.character + 1 : 0;
  // Collapse rather than emit an inverted range.
  if (
    end.line < start.line ||
    (end.line === start.line && endCharacter < start.character)
  ) {
    return { start, end: start };
  }
  return { start, end: { line: end.line, character: endCharacter } };
}

/**
 * Tree-sitter {@link Point} reached by inserting `text` at {@link start},
 * counting columns in UTF-16 code units (a `\n` resets the column; every
 * other unit advances it by one). A `for…of` code-point loop would miscount
 * astral characters by one per surrogate pair — this uses `text.length`.
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
  return { row: start.row + rows, column: text.length - lastNewline - 1 };
}
