import type { DiagramLayout, ParameterModel } from "@dicode/omc-client";

/**
 * Wire-format mirror of diagram-ui's `LibraryClassRestriction`.
 * Kept as a plain string union local to the protocol because the
 * extension host is CommonJS / Node16-resolution and importing
 * ESM-only type-only declarations from `@dicode/diagram-ui`
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
 *   - `parametersOpen`     — open the parameter modal for the given
 *                            `ParameterModel` (fields carry their own
 *                            values) + title. `kind` is an opaque tag the
 *                            extension uses to route the eventual submit
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
 *   - `actionUndo` / `actionCheck` / `actionSimulate` / `actionParameters`
 *                             — toolbar.
 *   - `editComponent`       — user double-clicked a sub-component on the
 *                             diagram and wants its parameter modal.
 *   - `parametersSubmit` / `parametersCancel` — parameter modal.
 *   - `resetComponentParameters` — user hit the modal's "Reset to
 *                             defaults" button (component params only);
 *                             the host bulk-clears the sub-component's
 *                             modifiers and re-opens the refreshed form.
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
      /**
       * The typed parameter model the form renders directly. Its fields
       * carry their own current values, type defaults, units, unit options,
       * Dialog tab/group/enable, and enum metadata — the webview no longer
       * parses JSON Schema for forms.
       */
      model: ParameterModel;
      title: string;
      submitLabel?: string;
      /**
       * Cref-prefix stripped by the form's Dialog.enable evaluator —
       * the sub-component instance name for `kind: "componentParams"`,
       * unset for class-level / simulate forms.
       */
      crefPrefix?: string;
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
    }
  | {
      // Response to `libraryIcon`. `svg` is a self-contained `<svg>`
      // thumbnail for the class's icon (rendered host-side via the cheap
      // `getModelInstanceAnnotation` path); absent on failure / no icon.
      type: "libraryIconResult";
      requestId: string;
      svg?: string;
      error?: string;
    };

export type WebviewToExtension =
  | { type: "ready" }
  | { type: "change"; layout: DiagramLayout }
  | {
      type: "connectionCreate";
      fromKey: string;
      toKey: string;
      /**
       * Waypoints (in diagram coords) describing the connection route,
       * including endpoints. Empty means "let OMC auto-route" — the
       * webview computes an orthogonal Z-shape by default.
       */
      waypoints: ReadonlyArray<readonly [number, number]>;
    }
  | { type: "selectionChange"; keys: string[] }
  | { type: "error"; message: string }
  | { type: "actionUndo" }
  | { type: "actionCheck" }
  | { type: "actionSimulate" }
  | { type: "actionParameters" }
  | { type: "editComponent"; componentName: string }
  | {
      type: "parametersSubmit";
      kind: string;
      values: Record<string, unknown>;
    }
  | { type: "parametersCancel"; kind: string }
  | {
      /**
       * "Reset to defaults" pressed in the component parameter modal.
       * `componentName` is the sub-component instance whose modifiers the
       * host should bulk-clear via `removeElementModifiers` before
       * re-opening the modal with the refreshed (defaulted) values. Only
       * dispatched for the `componentParams` modal — the class-level form
       * has no reset affordance.
       */
      type: "resetComponentParameters";
      componentName: string;
    }
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
  | { type: "librarySearch"; requestId: string; query: string }
  | {
      // Lazy request for a class's icon thumbnail — fired per row as it
      // becomes visible, so we never pay the icon fetch for the whole tree.
      type: "libraryIcon";
      requestId: string;
      className: string;
    };
