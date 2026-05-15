import type { DiagramLayout, JsonSchema } from "@modelica-wrapper/omc-client";

/**
 * Message protocol between the extension host (Node) and the diagram
 * webview (browser). All messages are JSON-serialisable.
 *
 * Extension → webview:
 *   - `init`            — sent once after the webview's `ready` to seed
 *                         it with the current `DiagramLayout`.
 *   - `layout`          — refreshed `DiagramLayout` (e.g. after a re-read
 *                         from OMC because the user accepted a mutation).
 *   - `error`           — surface a backend error to the webview UI.
 *   - `parametersOpen`  — open the parameter modal with the given
 *                         JSON Schema + initial values + title. `kind`
 *                         is an opaque tag the extension uses to route
 *                         the eventual submit message ("simulate",
 *                         "componentParams", …).
 *   - `parametersClose` — dismiss the parameter modal (usually fired by
 *                         the extension after handling a submit).
 *
 * Webview → extension:
 *   - `ready`             — webview has finished loading.
 *   - `change`            — user committed a layout change.
 *   - `connectionCreate`  — user dragged from one connector to another.
 *   - `selectionChange`   — selection set updated (for status bar etc.).
 *   - `error`             — diagnostic surface, e.g. couldn't load icons.
 *   - `actionCheck`       — user clicked the Check button on the action
 *                           panel.
 *   - `actionSimulate`    — user clicked Simulate.
 *   - `actionParameters`  — user clicked the Parameters button (for
 *                           model-level / component parameter editing).
 *   - `parametersSubmit`  — parameter modal was submitted; `kind`
 *                           matches the open message.
 *   - `parametersCancel`  — parameter modal was dismissed without
 *                           submitting (backdrop click, Esc, Cancel
 *                           button).
 */

export type ExtensionToWebview =
  | { type: "init"; layout: DiagramLayout; className: string }
  | { type: "layout"; layout: DiagramLayout }
  | { type: "error"; message: string }
  | {
      type: "parametersOpen";
      kind: string;
      schema: JsonSchema;
      values: Record<string, unknown>;
      title: string;
      submitLabel?: string;
    }
  | { type: "parametersClose" };

export type WebviewToExtension =
  | { type: "ready" }
  | { type: "change"; layout: DiagramLayout }
  | { type: "connectionCreate"; fromKey: string; toKey: string }
  | { type: "selectionChange"; keys: string[] }
  | { type: "error"; message: string }
  | { type: "actionCheck" }
  | { type: "actionSimulate" }
  | { type: "actionParameters" }
  | {
      type: "parametersSubmit";
      kind: string;
      values: Record<string, unknown>;
    }
  | { type: "parametersCancel"; kind: string };
