import type {
  ClassDef,
  DiagramLayout,
  ParameterModel,
} from "@dicode/omc-client";

/**
 * Wire-format mirror of diagram-ui's `DiagramCommandId`. Kept local because the
 * CommonJS extension host can't import the ESM-only diagram-ui package; the
 * webview side assigns it straight into diagram-ui's identical union.
 */
export type DiagramCommandId =
  | "diagram.delete"
  | "diagram.rotateCw"
  | "diagram.rotateCcw"
  | "diagram.flipHorizontal"
  | "diagram.flipVertical"
  | "diagram.deleteVertex"
  | "diagram.toggleSmooth";

/**
 * Message protocol between the extension host (Node) and the diagram
 * webview (browser). All messages are JSON-serializable.
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
 *
 * Webview → extension:
 *   - `ready`               — webview has finished loading.
 *   - `change`              — user committed a layout change.
 *   - `connectionCreate`    — user dragged from one connector to another.
 *   - `selectionChange`     — selection set updated.
 *   - `error`               — diagnostic surface.
 *   - `actionCheck` / `actionSimulate` / `actionParameters` — toolbar.
 *   - `editComponent`       — user double-clicked a sub-component on the
 *                             diagram and wants its parameter modal.
 *   - `parametersSubmit` / `parametersCancel` — parameter modal.
 *   - `resetComponentParameters` — user hit the modal's "Reset to
 *                             defaults" button (component params only);
 *                             the host bulk-clears the sub-component's
 *                             modifiers and re-opens the refreshed form.
 *   - `addComponent`        — user dropped or placed a class on the canvas
 *                             and we want to instantiate it into the active
 *                             diagram at `position`.
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
      // Host-resolved diagram shortcut (a VSCode keybinding fired while the
      // diagram panel was focused). The webview runs it through its registry.
      type: "runCommand";
      commandId: DiagramCommandId;
    }
  | {
      // Host-relayed placement: a library row was pressed in the sidebar
      // webview and dragged toward the canvas. The diagram arms its own
      // cursor-tracking ghost and commits on release over the canvas.
      type: "placementStart";
      className: string;
    }
  | {
      // The armed class's renderable definition, resolved by the host after the
      // placement started. Upgrades the crosshair to the real preview node.
      type: "placementPreview";
      className: string;
      classDef: ClassDef;
    }
  | { type: "placementCancel" };

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
  | {
      // Whether keyboard focus sits in an editable field inside the webview.
      // Drives the `modelicaDiagramInputFocus` context key so the diagram's
      // single-letter keybindings (r/f/Delete) don't fire while typing.
      type: "inputFocus";
      focused: boolean;
    }
  | { type: "error"; message: string }
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
      type: "changeClassRequest";
      componentName: string;
      currentClass: string;
    };
