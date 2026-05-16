import type { DiagramLayout, JsonSchema } from "@modelica-wrapper/omc-client";

/**
 * Wire-format mirror of diagram-ui's `LibraryClassRestriction`.
 * Kept as a plain string union local to the protocol because the
 * extension host is CommonJS / Node16-resolution and importing
 * ESM-only type-only declarations from `@modelica-wrapper/diagram-ui`
 * would need a `resolution-mode` import attribute. The webview side
 * still consumes diagram-ui's `LibraryClassInfo` — the shapes are
 * structurally identical so assignment is implicit.
 */
export type LibraryClassRestriction =
  | "package"
  | "model"
  | "block"
  | "class"
  | "connector"
  | "expandable connector"
  | "record"
  | "function"
  | "type"
  | "operator"
  | "operator function"
  | "operator record"
  | "unknown";

export interface LibraryClassInfo {
  qualified: string;
  restriction: LibraryClassRestriction;
}

/**
 * Message protocol between the extension host (Node) and the diagram
 * webview (browser). All messages are JSON-serialisable.
 *
 * Extension → webview:
 *   - `init`               — sent once after the webview's `ready` to
 *                            seed it with the current `DiagramLayout`.
 *   - `layout`             — refreshed `DiagramLayout` (e.g. after a
 *                            re-read from OMC because the user
 *                            accepted a mutation).
 *   - `error`              — surface a backend error to the webview UI.
 *   - `parametersOpen`     — open the parameter modal with the given
 *                            JSON Schema + initial values + title.
 *                            `kind` is an opaque tag the extension
 *                            uses to route the eventual submit
 *                            ("simulate", "componentParams", …).
 *   - `parametersClose`    — dismiss the parameter modal.
 *   - `libraryChildren`    — response to `libraryListChildren`.
 *   - `librarySearchResult`— response to `librarySearch`.
 *
 * Webview → extension:
 *   - `ready`               — webview has finished loading.
 *   - `change`              — user committed a layout change.
 *   - `connectionCreate`    — user dragged from one connector to another.
 *   - `selectionChange`     — selection set updated.
 *   - `error`               — diagnostic surface.
 *   - `actionCheck` / `actionSimulate` / `actionParameters` — toolbar.
 *   - `parametersSubmit` / `parametersCancel` — parameter modal.
 *   - `addComponent`        — user picked a class in the library
 *                             browser and we want to instantiate it
 *                             into the active diagram at `position`.
 *   - `libraryListChildren` — request: enumerate child classes of
 *                             `parent` (null for root packages).
 *   - `librarySearch`       — request: search loaded libraries.
 *
 * Library messages use a `requestId` so the webview can correlate
 * responses with in-flight Promises in its data source. The wire
 * format is deliberately tagged union; the webview's data source
 * holds a `Map<requestId, {resolve, reject}>` and drains it on the
 * matching response message.
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
  | { type: "parametersClose" }
  | {
      type: "libraryChildren";
      requestId: string;
      items?: LibraryClassInfo[];
      error?: string;
    }
  | {
      type: "librarySearchResult";
      requestId: string;
      items?: LibraryClassInfo[];
      error?: string;
    };

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
  | { type: "parametersCancel"; kind: string }
  | {
      type: "addComponent";
      className: string;
      position: { x: number; y: number };
    }
  | {
      type: "libraryListChildren";
      requestId: string;
      parent: string | null;
    }
  | { type: "librarySearch"; requestId: string; query: string };
