/**
 * VSCode `Pseudoterminal` for the Modelica REPL.
 *
 * Owns:
 *  - the current input buffer + cursor column (within the input area)
 *  - the history walker (in-memory, per-session)
 *  - a small queue: while an OMC call is in flight, additional Enter
 *    presses are buffered and processed in order. The shared
 *    `OmcClient.call` chain serialises *across* commands too, so the worst
 *    case is "this REPL waits for the previous REPL line to finish".
 *
 * Output rules (see spec):
 *  - Every line break written to the terminal is `\r\n`.
 *  - Errors are wrapped in `\x1b[31m…\x1b[0m`.
 *  - The prompt is dim-cyan: `\x1b[36momc> \x1b[0m`.
 *  - In-flight indicator: a dim `\x1b[2m... working\x1b[0m` line that we
 *    erase via `\r\x1b[K` before printing the result.
 *
 * Cursor math: we never let the cursor advance left of the prompt — at
 * column 0 of the input area, Backspace is a no-op (it does NOT chew the
 * `>` of the prompt). Arrow keys move within the input area only.
 */

import * as vscode from "vscode";

import {
  computeCompletion,
  computeGhost,
  formatColumns,
} from "./repl-complete.js";
import {
  evalLine,
  type ReplDependencies,
  type ReplResult,
} from "./repl-eval.js";
import { ReplHistory } from "./repl-history.js";

const PROMPT_TEXT = "omc> ";
const PROMPT = `\x1b[36m${PROMPT_TEXT}\x1b[0m`;
const WORKING = "\x1b[2m... working\x1b[0m";
const CLEAR_LINE = "\r\x1b[K";
/** SGR codes for the autosuggest ghost — dim, reset at end. */
const GHOST_OPEN = "\x1b[2m";
const GHOST_CLOSE = "\x1b[0m";
/** Fallback terminal width / height when no `setDimensions` has fired yet. */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
// Wipe the entire screen and home the cursor — same effect as Ctrl+L in
// most shells. ESC[2J clears the visible viewport, ESC[3J also drops the
// scrollback (VSCode honours both).
const CLEAR_SCREEN = "\x1b[2J\x1b[3J\x1b[H";

const BANNER = "Modelica REPL — type :help for commands, :exit to close.";

export class ModelicaReplPty implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private readonly closeEmitter = new vscode.EventEmitter<void>();

  readonly onDidWrite: vscode.Event<string> = this.writeEmitter.event;
  readonly onDidClose: vscode.Event<void> = this.closeEmitter.event;

  /** Current line buffer (text the user is editing, not the prompt). */
  private buffer = "";
  /** Cursor column within `buffer` (0 = right after the prompt). */
  private cursor = 0;
  /** True while an OMC call is in flight — input is queued, not processed. */
  private busy = false;
  /** Pending input lines submitted while busy. Processed FIFO when busy goes false. */
  private queue: string[] = [];
  /**
   * Transcript lines submitted from outside the pty (e.g. Check Model
   * tee-ing its result into the REPL). Drained after every `processLine`
   * settles, and also immediately when nothing is in flight.
   */
  private externalQueue: Array<{
    label: string;
    output: string;
    isError: boolean;
  }> = [];
  /** True once `open()` has fired — we MUST NOT write before then. */
  private opened = false;
  /** Buffered output emitted before `open()`; flushed on open. */
  private earlyBuffer = "";
  /**
   * Autosuggest tail — rendered in dim after `buffer` when the cursor is at
   * end-of-buffer. Accepted with → (and only when at end). Recomputed by
   * `repaint()` so any state change re-syncs it with the buffer.
   */
  private ghost = "";
  /** Latest known terminal width — used for the columnar Tab listing. */
  private cols = DEFAULT_COLS;
  /**
   * Latest known terminal height. Used to decide whether the columnar
   * listing fits in the visible viewport: if not, we fall back to a
   * scroll-friendly redraw instead of trying to cursor-up past content
   * that's already scrolled into the scrollback.
   */
  private rows = DEFAULT_ROWS;

  private readonly history = new ReplHistory();

  constructor(private readonly deps: ReplDependencies) {}

  // ── Pseudoterminal API ────────────────────────────────────────────────

  open(dim?: vscode.TerminalDimensions): void {
    this.opened = true;
    if (dim) {
      this.cols = dim.columns;
      this.rows = dim.rows;
    }
    if (this.earlyBuffer.length > 0) {
      this.writeEmitter.fire(this.earlyBuffer);
      this.earlyBuffer = "";
    }
    this.writeLine(BANNER);
    this.writePrompt();
  }

  setDimensions(dim: vscode.TerminalDimensions): void {
    this.cols = dim.columns;
    this.rows = dim.rows;
  }

  close(): void {
    // Free the emitters — VSCode tears down the rest.
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
  }

  handleInput(data: string): void {
    // Treat input as a stream — pasting / IME composition delivers
    // multi-character chunks and ANSI escape sequences arrive whole.
    for (let i = 0; i < data.length; ) {
      const ch = data[i];
      if (ch === undefined) break;

      // ── Special single-byte controls ────────────────────────────────
      if (ch === "\r" || ch === "\n") {
        this.onEnter();
        i += 1;
        continue;
      }
      if (ch === "\x7f" || ch === "\b") {
        this.onBackspace();
        i += 1;
        continue;
      }
      if (ch === "\x03") {
        this.onCtrlC();
        i += 1;
        continue;
      }
      if (ch === "\x0c") {
        this.onCtrlL();
        i += 1;
        continue;
      }
      if (ch === "\x09") {
        this.onTab();
        i += 1;
        continue;
      }

      // ── CSI / SS3 escape sequences ──────────────────────────────────
      if (ch === "\x1b") {
        const consumed = this.handleEscape(data, i);
        if (consumed > 0) {
          i += consumed;
          continue;
        }
        // Unknown escape — drop the ESC byte and keep going so we don't
        // splat raw control codes into the buffer.
        i += 1;
        continue;
      }

      // ── Printable / other ──────────────────────────────────────────
      // Grab a contiguous run of "ordinary" characters so paste is fast.
      let j = i;
      while (j < data.length) {
        const c = data[j];
        if (c === undefined) break;
        const code = c.charCodeAt(0);
        // Anything below 0x20 (control) or the DEL byte interrupts the run.
        if (code < 0x20 || c === "\x7f") break;
        j += 1;
      }
      if (j > i) {
        this.insertText(data.slice(i, j));
        i = j;
      } else {
        // Lone control byte we don't recognise — swallow it.
        i += 1;
      }
    }
  }

  // ── Key handlers ──────────────────────────────────────────────────────

  /**
   * Parse a CSI/SS3 sequence starting at `start` (the byte at `start` is
   * the ESC). Returns the number of bytes consumed, or 0 if the buffer
   * doesn't contain a complete sequence (rare in practice — terminals
   * deliver them whole, but we play safe).
   */
  private handleEscape(data: string, start: number): number {
    const next = data[start + 1];
    if (next === undefined) return 0;
    if (next !== "[" && next !== "O") return 0;
    const third = data[start + 2];
    if (third === undefined) return 0;

    // SS3 sequences (ESC O X) — only a handful in play.
    if (next === "O") {
      switch (third) {
        case "A":
          this.onArrowUp();
          return 3;
        case "B":
          this.onArrowDown();
          return 3;
        case "C":
          this.onArrowRight();
          return 3;
        case "D":
          this.onArrowLeft();
          return 3;
        case "H":
          this.onHome();
          return 3;
        case "F":
          this.onEnd();
          return 3;
        default:
          return 3;
      }
    }

    // CSI (ESC [ …). Some are single-letter (A/B/C/D/H/F), some are
    // numeric + `~` (e.g. ESC[1~ for Home, ESC[4~ for End).
    switch (third) {
      case "A":
        this.onArrowUp();
        return 3;
      case "B":
        this.onArrowDown();
        return 3;
      case "C":
        this.onArrowRight();
        return 3;
      case "D":
        this.onArrowLeft();
        return 3;
      case "H":
        this.onHome();
        return 3;
      case "F":
        this.onEnd();
        return 3;
      default:
        // Numeric — scan forward for `~`.
        if (third >= "0" && third <= "9") {
          let k = start + 2;
          while (k < data.length) {
            const c = data[k];
            if (c === undefined) return 0;
            if (c === "~") {
              const num = data.slice(start + 2, k);
              const consumed = k - start + 1;
              switch (num) {
                case "1":
                case "7":
                  this.onHome();
                  break;
                case "3":
                  this.onDelete();
                  break;
                case "4":
                case "8":
                  this.onEnd();
                  break;
                default:
                  break;
              }
              return consumed;
            }
            // Allow digits / `;` (parameters).
            if ((c < "0" || c > "9") && c !== ";") {
              // Unknown CSI — eat up to and including this byte.
              return k - start + 1;
            }
            k += 1;
          }
          return 0; // incomplete
        }
        return 3;
    }
  }

  private onEnter(): void {
    const line = this.buffer;
    // Move past the prompt + buffer onto a fresh line before evaluating.
    this.write("\r\n");
    this.history.push(line);
    if (this.busy) {
      // Queue and let the active task drain it after the in-flight call.
      this.queue.push(line);
      return;
    }
    void this.processLine(line);
    // After Enter, regardless of whether `processLine` returns sync or
    // async, the buffer is reset.
    this.buffer = "";
    this.cursor = 0;
  }

  private onBackspace(): void {
    if (this.cursor === 0) return; // never chew into the prompt
    this.buffer =
      this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
    this.cursor -= 1;
    this.repaint();
  }

  private onDelete(): void {
    if (this.cursor >= this.buffer.length) return;
    this.buffer =
      this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
    this.repaint();
  }

  private onCtrlC(): void {
    // Abandon the current input. Per spec we don't try to cancel an
    // in-flight OMC call (OMC has no cancel surface); just abandon the
    // editor state and warn the user when the prompt comes back.
    this.write("^C\r\n");
    this.buffer = "";
    this.cursor = 0;
    if (!this.busy) {
      this.writePrompt();
    }
    // When busy, the prompt will appear once the in-flight call resolves;
    // `processLine` emits the warning there.
  }

  private onCtrlL(): void {
    this.write(CLEAR_SCREEN);
    this.writePrompt();
    this.repaint();
  }

  private onArrowLeft(): void {
    if (this.cursor === 0) return;
    this.cursor -= 1;
    // Cursor leaving end-of-buffer means the ghost should disappear; a
    // full repaint reasserts the line invariant in one place.
    this.repaint();
  }

  private onArrowRight(): void {
    if (this.cursor < this.buffer.length) {
      this.cursor += 1;
      // Cursor reaching end-of-buffer might bring the ghost back.
      this.repaint();
      return;
    }
    // At end-of-buffer: → accepts the ghost (autosuggest "complete-word"
    // behaviour). Falls through to no-op if there's nothing to accept.
    if (this.ghost.length > 0) {
      this.insertText(this.ghost);
    }
  }

  private onArrowUp(): void {
    const replacement = this.history.up(this.buffer);
    this.replaceBuffer(replacement);
  }

  private onArrowDown(): void {
    const replacement = this.history.down(this.buffer);
    this.replaceBuffer(replacement);
  }

  private onHome(): void {
    this.cursor = 0;
    this.repaint();
  }

  private onEnd(): void {
    this.cursor = this.buffer.length;
    this.repaint();
  }

  /**
   * Tab completion. Behaviour mirrors a typical shell:
   *   - 0 candidates       → no-op (no bell — VSCode terminals don't have one).
   *   - 1 candidate        → insert the missing tail + trailing space.
   *   - N candidates with a longer common prefix → extend to that prefix.
   *   - N candidates with no further common prefix → leave the current line
   *     in place, print the candidate list in bash-style columns below,
   *     then redraw the prompt on a fresh line.
   */
  private onTab(): void {
    const plan = computeCompletion(this.buffer, this.cursor);
    if (plan.candidates.length === 0) return;
    const insertion = plan.commonPrefix.slice(plan.prefix.length);
    if (insertion.length > 0) {
      this.insertText(insertion);
      // After a unique completion, append a space so the user can keep typing
      // the next token without re-hitting space themselves.
      if (plan.candidates.length === 1) {
        this.insertText(" ");
      }
      return;
    }
    // No further unique characters → list the candidates.
    const lines = formatColumns(plan.candidates, this.cols);
    if (lines.length === 0) return;

    // The cursor-restore path (bash-style, keeps input visible) only
    // works when the listing fits inside the viewport. If we'd need
    // more rows than the terminal has, the listing scrolls, the input
    // moves into scrollback, and `\x1b[<n>A` would land on the wrong
    // row. In that case, drop to a scroll-friendly redraw: reprint the
    // input as a history line, print the listing, then repaint a fresh
    // prompt below.
    //
    // The `+ 1` accounts for the input line itself; we also need room
    // for at least one prompt line after, hence the strict `<`.
    if (lines.length + 1 < this.rows) {
      this.listInPlace(lines);
    } else {
      this.listScrolling(lines);
    }
  }

  /**
   * Print the candidate list on rows below the input line, then return
   * the cursor to its original position so the user keeps typing in
   * place. `\x1b[J` first wipes any prior listing further down — repeated
   * Tabs don't leave orphan rows.
   */
  private listInPlace(lines: string[]): void {
    this.write("\r\n\x1b[J");
    for (const line of lines) {
      this.write(`${line}\r\n`);
    }
    // Climb back to the input row. `\x1b[<n>A` is a relative cursor
    // move, so this survives any scroll the listing may have caused.
    this.write(`\x1b[${lines.length + 1}A`);
    // `A` lands at column 0; advance back to the logical cursor column
    // (prompt prefix + index inside the buffer). The ghost text on the
    // input line was never touched, so it stays in place.
    const col = PROMPT_TEXT.length + this.cursor;
    if (col > 0) this.write(`\x1b[${col}C`);
  }

  /**
   * Fallback used when the listing is taller than the viewport. The
   * input line is reprinted as a "history" line above the listing, the
   * candidates print on the rows below it, and a fresh prompt is
   * repainted at the bottom. This is what older revisions of the REPL
   * did unconditionally — it's the right thing when we'd otherwise be
   * scrolling the input out of view anyway.
   */
  private listScrolling(lines: string[]): void {
    this.write(`${CLEAR_LINE}${PROMPT}${this.buffer}\r\n`);
    for (const line of lines) {
      this.write(`${line}\r\n`);
    }
    this.repaint();
  }

  // ── Eval pipeline ────────────────────────────────────────────────────

  private async processLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      // Empty Enter — fresh prompt, no OMC chatter.
      this.writePrompt();
      this.drainQueueOrUnlock();
      return;
    }

    this.busy = true;
    this.write(`${WORKING}\r\n`);

    let result: ReplResult;
    try {
      result = await evalLine(line, this.deps);
    } catch (err) {
      result = {
        output: `error: ${(err as Error).message}`,
        isError: true,
      };
    }

    // Wipe the "... working" line we wrote a moment ago. The cursor is
    // on the line below it now — go up one row, then erase that row.
    this.write(`\x1b[1A${CLEAR_LINE}`);

    if (result.clearScreen) {
      this.write(CLEAR_SCREEN);
    }
    if (result.output.length > 0) {
      this.writeResultText(result.output, result.isError);
    }

    if (result.closeTerminal) {
      this.closeEmitter.fire();
      return;
    }

    this.writePrompt();
    this.busy = false;
    this.drainQueueOrUnlock();
  }

  private drainQueueOrUnlock(): void {
    if (this.queue.length === 0) {
      this.busy = false;
      // No pending REPL lines — flush any external transcripts that
      // arrived while we were busy. They print above the prompt now.
      this.flushExternalQueue();
      return;
    }
    const next = this.queue.shift();
    if (next === undefined) {
      this.busy = false;
      this.flushExternalQueue();
      return;
    }
    // Process FIFO. Note: we keep `busy = true` across the gap so a
    // subsequent Enter still queues rather than racing.
    this.busy = true;
    void this.processLine(next);
  }

  // ── External display API ─────────────────────────────────────────────

  /**
   * Print a transcript line that did NOT come from terminal input — e.g.
   * the result of the Check Model command. Renders as
   *   `omc> <label>\r\n<output>\r\n<prompt><current input>`
   * with cursor restored. If an OMC call is in flight, the entry is
   * queued and flushed after the in-flight call settles, so we never
   * tear the busy "... working" line.
   */
  showExternal(label: string, output: string, isError = false): void {
    if (this.busy) {
      this.externalQueue.push({ label, output, isError });
      return;
    }
    this.printExternal({ label, output, isError });
  }

  private flushExternalQueue(): void {
    while (this.externalQueue.length > 0) {
      const next = this.externalQueue.shift();
      if (!next) break;
      this.printExternal(next);
    }
  }

  private printExternal(entry: {
    label: string;
    output: string;
    isError: boolean;
  }): void {
    // Wipe the input line (prompt + user's in-progress buffer),
    // print the transcript on its own lines, then redraw prompt+buffer.
    // `redrawInputLine` puts the ghost back on the fresh prompt — the
    // buffer didn't change, so we don't need to recompute it.
    this.write(CLEAR_LINE);
    this.write(`${PROMPT}${entry.label}\r\n`);
    if (entry.output.length > 0) {
      this.writeResultText(entry.output, entry.isError);
    }
    this.redrawInputLine();
  }

  // ── Output helpers ───────────────────────────────────────────────────

  /** Low-level emit — never call from before `open()` without buffering. */
  private write(s: string): void {
    if (!this.opened) {
      this.earlyBuffer += s;
      return;
    }
    this.writeEmitter.fire(s);
  }

  /** Write a line of plain text with `\r\n` termination. */
  private writeLine(s: string): void {
    this.write(`${s}\r\n`);
  }

  private writePrompt(): void {
    this.write(PROMPT);
  }

  /**
   * Print a multi-line result. Newlines normalise to `\r\n`. If `isError`,
   * the whole block is wrapped in red.
   */
  private writeResultText(text: string, isError: boolean): void {
    const normalised = text.replace(/\r?\n/g, "\r\n");
    if (isError) {
      this.write(`\x1b[31m${normalised}\x1b[0m\r\n`);
    } else {
      this.write(`${normalised}\r\n`);
    }
  }

  /**
   * Recompute the ghost suggestion and repaint the input line. Single
   * source of truth for "the buffer / cursor changed, sync the screen."
   */
  private repaint(): void {
    this.ghost = computeGhost(this.buffer, this.cursor);
    this.redrawInputLine();
  }

  /**
   * Repaint the input area in place. `\r` returns the cursor to column 0,
   * `\x1b[K` clears from there to end of line, then we rewrite prompt +
   * buffer, append the dim ghost tail (if any), and reposition the cursor.
   *
   * Cursor restore math: after the writes, the cursor sits at
   * `buffer.length + ghost.length`. We move it back by
   * `(buffer.length - this.cursor) + ghost.length` so it lands at the
   * user's logical cursor — which is always at or before end-of-buffer
   * (ghost is only ever non-empty when cursor is at end).
   */
  private redrawInputLine(): void {
    this.write(`${CLEAR_LINE}${PROMPT}${this.buffer}`);
    if (this.ghost.length > 0) {
      this.write(`${GHOST_OPEN}${this.ghost}${GHOST_CLOSE}`);
    }
    const back = this.buffer.length - this.cursor + this.ghost.length;
    if (back > 0) {
      this.write(`\x1b[${back}D`);
    }
  }

  private replaceBuffer(next: string): void {
    this.buffer = next;
    this.cursor = next.length;
    this.repaint();
  }

  private insertText(s: string): void {
    if (s.length === 0) return;
    this.buffer =
      this.buffer.slice(0, this.cursor) + s + this.buffer.slice(this.cursor);
    this.cursor += s.length;
    this.repaint();
  }
}
