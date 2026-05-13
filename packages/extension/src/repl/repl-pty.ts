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

import { evalLine, type ReplDependencies, type ReplResult } from "./repl-eval.js";
import { ReplHistory } from "./repl-history.js";

const PROMPT_TEXT = "omc> ";
const PROMPT = `\x1b[36m${PROMPT_TEXT}\x1b[0m`;
const WORKING = "\x1b[2m... working\x1b[0m";
const CLEAR_LINE = "\r\x1b[K";
// Wipe the entire screen and home the cursor — same effect as Ctrl+L in
// most shells. ESC[2J clears the visible viewport, ESC[3J also drops the
// scrollback (VSCode honours both).
const CLEAR_SCREEN = "\x1b[2J\x1b[3J\x1b[H";

const BANNER =
  "Modelica REPL — type :help for commands, :exit to close.";

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
  /** True once `open()` has fired — we MUST NOT write before then. */
  private opened = false;
  /** Buffered output emitted before `open()`; flushed on open. */
  private earlyBuffer = "";

  private readonly history = new ReplHistory();

  constructor(private readonly deps: ReplDependencies) {}

  // ── Pseudoterminal API ────────────────────────────────────────────────

  open(_dim?: vscode.TerminalDimensions): void {
    this.opened = true;
    if (this.earlyBuffer.length > 0) {
      this.writeEmitter.fire(this.earlyBuffer);
      this.earlyBuffer = "";
    }
    this.writeLine(BANNER);
    this.writePrompt();
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
    this.redrawInputLine();
  }

  private onDelete(): void {
    if (this.cursor >= this.buffer.length) return;
    this.buffer =
      this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
    this.redrawInputLine();
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
    this.redrawInputLine();
  }

  private onArrowLeft(): void {
    if (this.cursor === 0) return;
    this.cursor -= 1;
    this.write("\x1b[D");
  }

  private onArrowRight(): void {
    if (this.cursor >= this.buffer.length) return;
    this.cursor += 1;
    this.write("\x1b[C");
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
    this.redrawInputLine();
  }

  private onEnd(): void {
    this.cursor = this.buffer.length;
    this.redrawInputLine();
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
      return;
    }
    const next = this.queue.shift();
    if (next === undefined) {
      this.busy = false;
      return;
    }
    // Process FIFO. Note: we keep `busy = true` across the gap so a
    // subsequent Enter still queues rather than racing.
    this.busy = true;
    void this.processLine(next);
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
   * Repaint the input area in place. `\r` returns the cursor to column 0,
   * `\x1b[K` clears from there to end of line, then we rewrite prompt +
   * buffer and reposition the cursor to `this.cursor`.
   */
  private redrawInputLine(): void {
    this.write(`${CLEAR_LINE}${PROMPT}${this.buffer}`);
    // Move the cursor backwards from end-of-buffer to `this.cursor`.
    const back = this.buffer.length - this.cursor;
    if (back > 0) {
      this.write(`\x1b[${back}D`);
    }
  }

  private replaceBuffer(next: string): void {
    this.buffer = next;
    this.cursor = next.length;
    this.redrawInputLine();
  }

  private insertText(s: string): void {
    if (s.length === 0) return;
    this.buffer =
      this.buffer.slice(0, this.cursor) + s + this.buffer.slice(this.cursor);
    this.cursor += s.length;
    this.redrawInputLine();
  }
}
