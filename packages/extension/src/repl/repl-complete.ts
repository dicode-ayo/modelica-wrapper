/**
 * Tab-completion candidate generation for the REPL.
 *
 * Pure: takes the current input buffer + cursor and returns the
 * completion plan. The pty drives the actual redraw.
 *
 * Two recognisable contexts:
 *   - `:command` form — completes against META_COMMANDS.
 *   - Bare-word form — completes against OMC function names. Activated
 *     anywhere a word boundary precedes the cursor, INCLUDING right
 *     after `:help ` so `:help getCl<Tab>` lists `getClassNames`, etc.
 *
 * "Word" is `[A-Za-z0-9_:]+`. We intentionally include `:` so a `:lo`
 * prefix is treated as one token (a meta-command) instead of two.
 */

import { omcFunctionNames } from "@dicode/omc-client";

import { META_COMMANDS } from "./repl-help.js";

export interface CompletionPlan {
  /** Substring of the buffer that should be replaced. */
  prefix: string;
  /** Candidates whose `startsWith(prefix)` matched. Sorted alphabetically. */
  candidates: string[];
  /** Longest prefix shared by every candidate — the "safe" completion. */
  commonPrefix: string;
}

export function computeCompletion(buffer: string, cursor: number): CompletionPlan {
  const before = buffer.slice(0, cursor);
  // Greedy match: longest trailing identifier-like run.
  const match = /[A-Za-z0-9_:]*$/.exec(before);
  const prefix = match ? match[0] : "";

  const source = selectSource(buffer, prefix);
  const candidates = source.filter((c) => c.startsWith(prefix)).sort();
  return {
    prefix,
    candidates,
    commonPrefix: longestCommonPrefix(candidates),
  };
}

/**
 * Decide which candidate set to draw from given the current input.
 *
 *   - If the buffer up to the cursor LOOKS like a meta-command line
 *     (begins with `:` and has no space yet) → meta-command names.
 *   - If the buffer starts with `:help <something` or `:help ` →
 *     OMC function names (most useful expansion target).
 *   - Otherwise → OMC function names.
 */
function selectSource(buffer: string, prefix: string): string[] {
  const trimmed = buffer.trimStart();
  if (trimmed.startsWith(":") && !trimmed.slice(1).includes(" ")) {
    // No space yet — completing the meta verb itself. Anchor on `:`.
    if (prefix.startsWith(":") || prefix === "") {
      return META_COMMANDS.map((m) => m.name);
    }
  }
  // Anywhere else: OMC function names. `omcFunctionNames` is already sorted
  // but we re-sort after filtering above so a smaller pool stays sorted.
  return [...omcFunctionNames];
}

/**
 * "Ghost text" suggestion — the tail of the alphabetically-first candidate
 * that extends the prefix at the cursor. Empty string when there's nothing
 * to suggest:
 *   - cursor isn't at end-of-buffer (we don't visually shove text past the
 *     user's edit point),
 *   - buffer is empty (suggesting on empty input feels noisy),
 *   - no candidate matches the trailing word,
 *   - the prefix is empty (cursor is on a fresh word boundary — same
 *     reasoning as "buffer empty").
 *
 * The tail is what we render in dim after the cursor; pressing → at
 * end-of-buffer accepts it.
 */
export function computeGhost(buffer: string, cursor: number): string {
  if (cursor !== buffer.length || buffer.length === 0) return "";
  const plan = computeCompletion(buffer, cursor);
  if (plan.candidates.length === 0 || plan.prefix.length === 0) return "";
  return plan.candidates[0]!.slice(plan.prefix.length);
}

/**
 * Lay `items` out as alphabetical columns that fit `cols` characters wide,
 * matching bash/zsh `<Tab><Tab>` behaviour. Returns the lines to print, in
 * order, without trailing newlines.
 *
 * Layout is column-major (reading top-to-bottom of column 1, then column 2,
 * etc., produces the sorted order). Items are padded to a uniform column
 * width with a `gap` between columns; the last column on each row is left
 * un-padded so we don't trail whitespace.
 */
export function formatColumns(
  items: ReadonlyArray<string>,
  cols: number,
  gap = 2,
): string[] {
  if (items.length === 0) return [];
  const maxLen = items.reduce((m, s) => Math.max(m, s.length), 0);
  const colWidth = maxLen + gap;
  const numCols = Math.max(1, Math.floor(cols / colWidth));
  const numRows = Math.ceil(items.length / numCols);
  const lines: string[] = [];
  for (let row = 0; row < numRows; row++) {
    let line = "";
    for (let col = 0; col < numCols; col++) {
      const idx = col * numRows + row;
      if (idx >= items.length) break; // sparse trailing slot
      line += items[idx]!.padEnd(colWidth);
    }
    // Pad-then-trim is simpler than computing per-row last-column logic:
    // intermediate columns keep their alignment, the row drops any tail
    // whitespace either from the gap of the last item OR from unfilled slots.
    lines.push(line.trimEnd());
  }
  return lines;
}

function longestCommonPrefix(words: ReadonlyArray<string>): string {
  if (words.length === 0) return "";
  if (words.length === 1) return words[0]!;
  let out = words[0]!;
  for (let i = 1; i < words.length; i++) {
    const w = words[i]!;
    let k = 0;
    const max = Math.min(out.length, w.length);
    while (k < max && out.charCodeAt(k) === w.charCodeAt(k)) k++;
    out = out.slice(0, k);
    if (out.length === 0) break;
  }
  return out;
}
