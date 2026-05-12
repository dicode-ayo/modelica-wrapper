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

export const log = {
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
