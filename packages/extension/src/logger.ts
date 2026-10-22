/**
 * Single OutputChannel for diagnostic logging from the extension host.
 *
 * Visible in VSCode's Output panel (View → Output) by selecting "Modelica"
 * from the dropdown. Webview-side logs go to the webview's own devtools
 * console — `Developer: Open Webview Developer Tools` — and are prefixed
 * with `[modelica.<topic>]` for easy filtering.
 */

import * as vscode from "vscode";

let channel: vscode.LogOutputChannel | undefined;

function ensureChannel(): vscode.LogOutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("Modelica", { log: true });
  }
  return channel;
}

/**
 * Bounds one channel line. A single OMC payload — a class dump, a full source
 * string, `list(Modelica)` typed at the REPL — can run past 300 KB (issue
 * #658), which would otherwise flood the channel for one call.
 *
 * This has to clear the per-value bound `@dicode/modelica-mcp` applies to its
 * own lines: a dispatch line carries two capped values (`fn input -> output`),
 * each with its own overflow suffix, so at equal bounds the argument fills the
 * line and evicts the result behind it. `logger.test.ts` pins the worst case.
 */
export const MAX_LINE_CHARS = 20_000;

export function bounded(line: string): string {
  if (line.length <= MAX_LINE_CHARS) return line;
  const suffix = `… (${line.length} chars total)`;
  return `${line.slice(0, MAX_LINE_CHARS - suffix.length)}${suffix}`;
}

export const log = {
  /**
   * Low-importance trace for expected, high-frequency failures on a hot path —
   * e.g. an OMC lookup that throws for a name that simply doesn't resolve. Use
   * this, not `warn`, for the resolution/completion layer's swallowed
   * not-found cases. Hidden at the default log level; "Developer: Set Log
   * Level…" reveals it in a running window.
   */
  debug(topic: string, message: string, data?: unknown): void {
    // The channel drops the line, but not the serialising a payload costs.
    const ch = ensureChannel();
    if (ch.logLevel > vscode.LogLevel.Debug) return;
    const payload = data === undefined ? "" : ` ${describe(data)}`;
    ch.debug(bounded(`[${topic}] ${message}${payload}`));
  },
  info(topic: string, message: string, data?: unknown): void {
    const payload = data === undefined ? "" : ` ${safeStringify(data)}`;
    ensureChannel().info(bounded(`[${topic}] ${message}${payload}`));
  },
  warn(topic: string, message: string, data?: unknown): void {
    const payload = data === undefined ? "" : ` ${safeStringify(data)}`;
    ensureChannel().warn(bounded(`[${topic}] ${message}${payload}`));
  },
  error(topic: string, message: string, err: unknown): void {
    const detail =
      err instanceof Error ? (err.stack ?? err.message) : safeStringify(err);
    ensureChannel().error(bounded(`[${topic}] ${message}\n${detail}`));
  },
  /** Reveal the output panel so the user can see logs without hunting for it. */
  show(): void {
    ensureChannel().show(true);
  },
  dispose(): void {
    channel?.dispose();
    channel = undefined;
  },
};

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * A short one-line description of a value for `debug` — an `Error`'s message
 * (its props aren't enumerable, so `JSON.stringify` would render `{}`),
 * otherwise the JSON form.
 */
function describe(v: unknown): string {
  return v instanceof Error ? v.message : safeStringify(v);
}
