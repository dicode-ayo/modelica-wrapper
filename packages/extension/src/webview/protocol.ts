import type { DiagramLayout } from "@modelica-wrapper/omc-client";

/**
 * Message protocol between the extension host (Node) and the diagram
 * webview (browser). All messages are JSON-serialisable.
 *
 * Extension → webview:
 *   - `init`   — sent once after the webview's `ready` to seed it with
 *                the current `DiagramLayout`.
 *   - `layout` — refreshed `DiagramLayout` (e.g. after a re-read from
 *                OMC because the user accepted a mutation).
 *   - `error`  — surface a backend error to the webview UI.
 *
 * Webview → extension:
 *   - `ready`           — webview has finished loading.
 *   - `change`          — user committed a layout change.
 *   - `connectionCreate` — user dragged from one connector to another.
 *   - `selectionChange` — selection set updated (for status bar etc.).
 *   - `error`           — diagnostic surface, e.g. couldn't load icons.
 */

export type ExtensionToWebview =
  | { type: "init"; layout: DiagramLayout; className: string }
  | { type: "layout"; layout: DiagramLayout }
  | { type: "error"; message: string };

export type WebviewToExtension =
  | { type: "ready" }
  | { type: "change"; layout: DiagramLayout }
  | { type: "connectionCreate"; fromKey: string; toKey: string }
  | { type: "selectionChange"; keys: string[] }
  | { type: "error"; message: string };
