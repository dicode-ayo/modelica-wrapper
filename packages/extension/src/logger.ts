/**
 * Single OutputChannel for diagnostic logging from the extension host.
 *
 * Visible in VSCode's Output panel (View → Output) by selecting "Modelica"
 * from the dropdown. Webview-side logs go to the webview's own devtools
 * console — `Developer: Open Webview Developer Tools` — and are prefixed
 * with `[modelica.<topic>]` for easy filtering.
 */

import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

function ensureChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("Modelica");
  }
  return channel;
}

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

/**
 * Whether {@link log.debug} actually writes. Debug is OFF by default so the
 * hot path (a fast-typing completion fans out to many swallowed not-found OMC
 * lookups, each a `log.debug`) doesn't spam the OutputChannel — gating prominence
 * alone (the `DEBUG` prefix) didn't reduce the write *volume*. Enable it by
 * setting `MODELICA_DEBUG` to a non-empty, non-`0`/`false` value before launching
 * the extension host. Read per-call (not cached) so it can be toggled at runtime
 * and so tests can flip it without re-importing the module.
 */
function debugEnabled(): boolean {
  const flag = process.env.MODELICA_DEBUG;
  return flag !== undefined && flag !== "" && flag !== "0" && flag !== "false";
}

export const log = {
  /**
   * Low-importance trace for expected, high-frequency failures on a hot path —
   * e.g. an OMC lookup that throws for a name that simply doesn't resolve. Goes
   * to the channel marked `DEBUG` so there is *a* trace when diagnosing, without
   * the prominence (or the implication of a real problem) of `warn`/`error`.
   * Use this, not `warn`, for the resolution/completion layer's swallowed
   * not-found cases. **Gated** behind {@link debugEnabled} (the `MODELICA_DEBUG`
   * env var) — silent by default so the hot path isn't spammed by volume, yet
   * enableable for diagnosis.
   */
  debug(topic: string, message: string, data?: unknown): void {
    if (!debugEnabled()) return;
    const payload = data === undefined ? "" : ` ${describe(data)}`;
    ensureChannel().appendLine(`${ts()} [${topic}] DEBUG ${message}${payload}`);
  },
  info(topic: string, message: string, data?: unknown): void {
    const payload = data === undefined ? "" : ` ${safeStringify(data)}`;
    ensureChannel().appendLine(`${ts()} [${topic}] ${message}${payload}`);
  },
  warn(topic: string, message: string, data?: unknown): void {
    const payload = data === undefined ? "" : ` ${safeStringify(data)}`;
    ensureChannel().appendLine(`${ts()} [${topic}] WARN ${message}${payload}`);
  },
  error(topic: string, message: string, err: unknown): void {
    const detail =
      err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : safeStringify(err);
    ensureChannel().appendLine(`${ts()} [${topic}] ERROR ${message}\n${detail}`);
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
