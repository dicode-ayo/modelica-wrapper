import type * as vscode from "vscode";

import type { ExtensionToWebview } from "./protocol.js";

export interface ReadyGate<M = ExtensionToWebview> {
  /** Post a message, buffering it until the webview has signalled `ready`. */
  send(msg: M): void;
  /** Mark the webview ready and flush any buffered messages, once. */
  markReady(): void;
}

/**
 * Buffer host→webview messages until the webview bundle reports `ready`, then
 * flush them in order. A seed message posted before the webview's listener is
 * mounted is dropped silently, so every seed must wait on the `ready`
 * handshake.
 */
export function createReadyGate<M = ExtensionToWebview>(
  webview: vscode.Webview,
): ReadyGate<M> {
  let ready = false;
  const pending: M[] = [];
  return {
    send(msg: M) {
      if (!ready) {
        pending.push(msg);
        return;
      }
      void webview.postMessage(msg);
    },
    markReady() {
      if (ready) return;
      ready = true;
      for (const msg of pending) void webview.postMessage(msg);
      pending.length = 0;
    },
  };
}
