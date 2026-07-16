import type { DocumentationInterface } from "@dicode/documentation-ui/interface-model";

/**
 * Message protocol between the extension host (Node) and the documentation
 * webview (browser). All messages are JSON-serializable.
 *
 * Extension → webview:
 *   - `doc`       — the class's `Documentation(info=…)` HTML, whether the class
 *                   is read-only, and a `resources` map resolving each
 *                   `modelica://` image `src` to a `data:` URI. Sent once after
 *                   the webview's `ready` handshake, and again after a reverse
 *                   sync (an undo/redo or manual text edit reloaded the
 *                   annotation).
 *   - `interface` — the auto-generated interface sections (extends tree,
 *                   parameters, connectors), sent right after the `doc` it
 *                   belongs to. Split out so the HTML paints without waiting on
 *                   the full `getModelInstance`; absent when the class can't
 *                   instantiate or isn't a kind worth instantiating (a package,
 *                   function, `type`, or builtin).
 *   - `error`     — surface a backend error (e.g. the OMC read or write failed).
 *
 * Webview → extension:
 *   - `ready`      — the webview bundle has mounted and is listening.
 *   - `edit`       — the user changed the documentation; carries the full
 *                    canonical `info` (wrapper included) to write back.
 *   - `editSource` — the user asked to edit the raw HTML; the host opens a
 *                    native HTML editor on the class's `info`.
 *   - `openLink`   — the user followed a `modelica://` link; the host resolves
 *                    it and opens the target class's documentation (or file).
 */
export type DocExtensionToWebview =
  | {
      type: "doc";
      className: string;
      info: string;
      readOnly: boolean;
      resources: Record<string, string>;
    }
  | { type: "interface"; className: string; interface: DocumentationInterface }
  | { type: "error"; message: string };

export type DocWebviewToExtension =
  | { type: "ready" }
  | { type: "edit"; info: string }
  | { type: "editSource" }
  | { type: "openLink"; href: string };
