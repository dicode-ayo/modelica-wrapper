import type {
  ClassDef,
  DiagramLayout,
  ParameterModel,
} from "@dicode/omc-client";

import type { DiagramMode } from "../diagram/view-type.js";
import type { ParameterFormKind } from "./gestures.js";

/**
 * Re-exported from the `command-ids` subpath rather than the package root: the
 * root drags in the Lit and Pixi component tree, whose types need the DOM lib
 * the host's Node program doesn't have.
 */
import type { DiagramCommandId } from "@dicode/diagram-ui/command-ids";

export type { DiagramCommandId };

/**
 * The webview → host half of the protocol. Its variants are derived from the
 * gesture table in `gestures.ts`, which also answers each gesture's ordering
 * and icon-mode policy; re-exported here so both halves of the protocol are
 * reachable from one module.
 */
export type { ParameterFormKind, WebviewToExtension } from "./gestures.js";

/**
 * Host → webview messages. All payloads are JSON-serializable.
 *
 *   - `init`               — sent once after the webview's `ready` to
 *                            seed it with the current `DiagramLayout`.
 *   - `layout`             — refreshed `DiagramLayout` (e.g. after a
 *                            re-read from OMC because the user
 *                            accepted a mutation).
 *   - `error`              — surface a backend error to the webview UI.
 *   - `renderError`        — the initial layout fetch failed, so there is
 *                            no canvas to show; the webview replaces it
 *                            with a full error state.
 *   - `parametersOpen`     — open the parameter modal for the given
 *                            `ParameterModel` (fields carry their own
 *                            values) + title. `kind` (a `ParameterFormKind`)
 *                            routes the eventual submit and gates whether the
 *                            form is read-only.
 *   - `parametersClose`    — dismiss the parameter modal.
 *   - `clipboard`          — the shared diagram clipboard filled or emptied;
 *                            gates the paste affordance. Broadcast to every
 *                            open editor, since the clipboard is window-wide.
 */
export type ExtensionToWebview =
  | {
      type: "init";
      layout: DiagramLayout;
      /** Stamp of `layout` — see the `layout` variant. */
      layoutVersion: number;
      className: string;
      /** True for a read-only class (system library); the webview suppresses all edit affordances. */
      readOnly: boolean;
      /** Whether the window-wide diagram clipboard already holds something. */
      hasClipboard: boolean;
    }
  | {
      type: "layout";
      layout: DiagramLayout;
      /**
       * Monotonic per-editor stamp of this layout. The webview echoes the
       * stamp of the last push it applied on every `change` report
       * (`basedOn`) — see `DiagramEditController.applyChange`.
       */
      layoutVersion: number;
    }
  | { type: "clipboard"; hasClipboard: boolean }
  | {
      // Replace the webview's selection — sent after a paste so the fresh
      // components are the ones under the next drag.
      type: "select";
      keys: string[];
    }
  | { type: "error"; message: string }
  | {
      type: "renderError";
      className: string;
      mode: DiagramMode;
      /** Backend failure text, e.g. `ModelInstanceNotFullyLoadedError`'s
       *  message. */
      detail: string;
    }
  | {
      type: "parametersOpen";
      kind: ParameterFormKind;
      /**
       * The typed parameter model the form renders directly. Its fields carry
       * their own current values, type defaults, units, unit options, Dialog
       * tab/group/enable, and enum metadata.
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

/**
 * Every {@link ExtensionToWebview} variant, as a lookup. Its type makes the
 * table exhaustive: a new outbound message that isn't listed here fails to
 * compile, rather than being dropped at the webview's boundary.
 */
const EXTENSION_MESSAGE_TYPES: Readonly<
  Record<ExtensionToWebview["type"], true>
> = {
  init: true,
  layout: true,
  clipboard: true,
  select: true,
  error: true,
  renderError: true,
  parametersOpen: true,
  parametersClose: true,
  runCommand: true,
  placementStart: true,
  placementPreview: true,
  placementCancel: true,
};

/**
 * Narrow a raw `postMessage` payload arriving in the webview. Only the
 * discriminant is checked: the host is the sole sender and every send site is
 * typed, so the payload behind a recognised `type` is already the one it names.
 */
export function isExtensionMessage(
  value: unknown,
): value is ExtensionToWebview {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    Object.hasOwn(EXTENSION_MESSAGE_TYPES, value.type)
  );
}
