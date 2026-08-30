/**
 * Typed event details emitted by `<om-graphical-layout>`.
 *
 * Each event has a dedicated `*Detail` interface so consumers can:
 *   - import the named type directly (`import type { ConnectionCreateDetail }`)
 *     without going through the map, and
 *   - hover-tooltip / go-to-definition lands on a clean symbol rather
 *     than an inline object literal inside a record type.
 *
 * The `LayoutEvents` map below ties each event name to its detail type
 * so the internal `emit<K>` and the external `CustomEvent<LayoutEvents[K]>`
 * listener pattern stays one source of truth — rename / shape change
 * surfaces as a type error on both sides instead of silently drifting.
 *
 * No Zod runtime checks — these events never cross a process boundary
 * (CustomEvent stays inside one browser context).
 */

import type { DiagramLayout } from "@dicode/omc-client";

import type { GoToSourceRequest } from "../commands/command.js";
import type { InteractionEvents } from "../interaction/interaction-manager.js";
import type { DiagramPoint } from "../scene/view-math.js";
import type { ToolId } from "../interaction/tools.js";

/** Endpoints + routing waypoints of a connection-create commit. */
export interface ConnectionCreateDetail {
  fromKey: string;
  toKey: string;
  /** Includes endpoints. Empty → "auto-route" (host sends no points to OMC). */
  waypoints: ReadonlyArray<readonly [number, number]>;
}

/** User picked a class to instantiate at `position`. */
export interface AddComponentRequestDetail {
  className: string;
  position: DiagramPoint;
}

/** New selection set, in canonical entity-key form. */
export interface SelectionChangeDetail {
  keys: string[];
}

/** Single-entity gesture payload — used by `om-double-click`. */
export interface DoubleClickDetail {
  key: string;
}

/** Layout commit — drag-end, keyboard edit, etc. The full layout, not a diff. */
export type LayoutChangeDetail = DiagramLayout;

/** Right-button up; `key` is `null` on empty canvas. */
export type ContextMenuDetail = InteractionEvents["contextMenu"];

/** The armed drawing tool changed (toolbar pick, Escape, readonly). */
export interface ToolChangeDetail {
  tool: ToolId;
}

/** User triggered "Change class" on a selected component. */
export interface ChangeClassRequestDetail {
  componentName: string;
  /** Fully-qualified current type — pre-filled value for the host's input box. */
  currentClass: string;
}

/**
 * User invoked copy or paste. The clipboard lives in the host (it is shared
 * across editors), so the layout reports the gesture and — for a copy — what
 * was selected, rather than carrying a payload of its own.
 */
export type ClipboardRequestDetail =
  | { action: "copy"; keys: string[] }
  | { action: "paste" };

/**
 * User asked to open an entity's source. Editors live host-side, so the
 * layout reports the already-resolved location rather than opening anything.
 */
export type GoToSourceRequestDetail = GoToSourceRequest;

/**
 * Event-name → detail-type map. Source of truth shared by:
 *   - `emit<K extends LayoutEventName>(name, detail)` inside the component,
 *   - external listeners typed `CustomEvent<LayoutEvents["om-foo"]>`.
 */
export interface LayoutEvents {
  "om-graphical-layout-change": LayoutChangeDetail;
  "om-selection-change": SelectionChangeDetail;
  "om-double-click": DoubleClickDetail;
  "om-context-menu": ContextMenuDetail;
  "om-connection-create": ConnectionCreateDetail;
  "om-add-component-request": AddComponentRequestDetail;
  "om-tool-change": ToolChangeDetail;
  "om-change-class-request": ChangeClassRequestDetail;
  "om-clipboard-request": ClipboardRequestDetail;
  "om-go-to-source": GoToSourceRequestDetail;
}

export type LayoutEventName = keyof LayoutEvents;

/** Helper that narrows `Event` to the typed `CustomEvent` for `K`. */
export type LayoutEvent<K extends LayoutEventName> = CustomEvent<
  LayoutEvents[K]
>;
