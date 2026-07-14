/**
 * Message protocol between the extension host (Node) and the documentation
 * webview (browser). All messages are JSON-serializable.
 *
 * Extension → webview:
 *   - `doc`   — the class's `Documentation(info=…)` HTML, sent once after the
 *               webview's `ready` handshake.
 *   - `error` — surface a backend error (e.g. the OMC fetch failed).
 *
 * Webview → extension:
 *   - `ready` — the webview bundle has mounted and is listening.
 */
export type DocExtensionToWebview =
  | { type: "doc"; className: string; info: string }
  | { type: "error"; message: string };

export type DocWebviewToExtension = { type: "ready" };
