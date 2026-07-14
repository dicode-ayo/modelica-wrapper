/**
 * Message protocol between the extension host (Node) and the documentation
 * webview (browser). All messages are JSON-serializable.
 *
 * Extension → webview:
 *   - `doc`   — the class's `Documentation(info=…)` HTML plus whether the class
 *               is read-only. Sent once after the webview's `ready` handshake,
 *               and again after a reverse sync (an undo/redo or manual text edit
 *               reloaded the annotation from the buffer).
 *   - `error` — surface a backend error (e.g. the OMC read or write failed).
 *
 * Webview → extension:
 *   - `ready`      — the webview bundle has mounted and is listening.
 *   - `edit`       — the user changed the documentation; carries the full
 *                    canonical `info` (wrapper included) to write back.
 *   - `editSource` — the user asked to edit the raw HTML; the host opens a
 *                    native HTML editor on the class's `info`.
 */
export type DocExtensionToWebview =
  | { type: "doc"; className: string; info: string; readOnly: boolean }
  | { type: "error"; message: string };

export type DocWebviewToExtension =
  | { type: "ready" }
  | { type: "edit"; info: string }
  | { type: "editSource" };
