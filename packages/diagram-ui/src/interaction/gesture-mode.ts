import type { Color3, Node } from "@babylonjs/core";

import {
  entityKeyForNode,
  formatKey,
  type EntityKey,
  type EntityKind,
} from "./node-keys.js";

export type Picker = (clientX: number, clientY: number) => Node | null;
export type ClientToDiagram = (
  clientX: number,
  clientY: number,
) => { x: number; y: number } | null;

/** Diagram-space position of a connector, for placing the routing wire. */
export type ConnectorPosition = (
  key: string,
) => { x: number; y: number } | null;

/** Local type/causality check between two connector keys; `null` when
 *  there's no snap target yet. */
export type CompatCheck = (
  from: string,
  toKey: string | null,
) => { ok: boolean; reason?: string } | null;

/**
 * The transient-feedback surface a gesture mode draws on while in flight.
 * `GestureOverlay` satisfies it; tests pass a recording stub.
 */
export interface OverlayHandle {
  showWire(
    from: { x: number; y: number },
    to: { x: number; y: number },
    color: Color3,
  ): void;
  hideWire(): void;
  showRect(rect: { x1: number; y1: number; x2: number; y2: number }): void;
  hideRect(): void;
}

export interface DragEvents {
  drag: {
    keys: string[];
    dx: number;
    dy: number;
    draft: boolean;
  };
  resize: {
    key: string;
    corner: "tl" | "tr" | "bl" | "br";
    x: number;
    y: number;
    draft: boolean;
  };
  rubberBand: {
    rect: { x1: number; y1: number; x2: number; y2: number };
    draft: boolean;
  };
  /**
   * Rotate drag from a shape's rotate handle. `key` is the owning shape;
   * `x, y` is the live pointer in diagram coords (the host derives the
   * angle from the shape's centre). `free` mirrors the Shift modifier —
   * true disables angle snapping. Draft on every move, committed on
   * pointerup like the other drags.
   */
  rotate: {
    key: string;
    x: number;
    y: number;
    free: boolean;
    draft: boolean;
  };
  /**
   * In-progress connection drag: user pulls from a connector's port
   * indicator. `from` is the source connector key (e.g. `k:p`), `to`
   * is the live cursor position in diagram coords. `commit=false`
   * while dragging; `commit=true` on pointerup. When committed and
   * `toKey` is present the host element should treat that as a
   * connection-create request.
   */
  connection: {
    from: string;
    to: { x: number; y: number };
    toKey: string | null;
    commit: boolean;
  };
  /**
   * Drag of a connection's edge line. `connIdx` identifies the
   * connection; `grab` is the diagram-coord point the gesture started
   * on (used by the host to pick which segment moves); `dx, dy` is the
   * cumulative delta from that point. The host moves the grabbed
   * segment orthogonally, inserting jog waypoints as needed. Draft on
   * every move, committed on pointerup.
   */
  edgeDrag: {
    connIdx: number;
    grab: { x: number; y: number };
    dx: number;
    dy: number;
    draft: boolean;
  };
}

export type DragEmit = <K extends keyof DragEvents>(
  type: K,
  detail: DragEvents[K],
) => void;

/** Returns the selection so a move drag knows what to carry. */
export type SelectionProvider = () => string[];

export type DiagramPoint = { x: number; y: number };

/** What the router resolved for the `pointerdown` that may start a gesture. */
export interface GestureStart {
  node: Node | null;
  entity: EntityKey | null;
  point: DiagramPoint;
  shiftKey: boolean;
  getSelectionKeys: SelectionProvider;
}

/**
 * A press-drag gesture. The state manager hit-tests on `pointerdown`,
 * routes to the matching mode, and calls `begin`; if it returns true the
 * gesture owns subsequent `update`/`commit` until `pointerup`. Hover and
 * click-select are not modes — they run always, underneath.
 */
export interface GestureMode {
  readonly id: "select" | "drag" | "connect";
  begin(start: GestureStart): boolean;
  update(point: DiagramPoint, e: PointerEvent): void;
  commit(point: DiagramPoint, e: PointerEvent): void;
}

/**
 * Entity kinds that begin a move-drag. Connectors are deliberately
 * excluded: clicking anywhere on a connector starts a connection drag
 * instead, matching OMEdit.
 */
export const MOVE_KINDS: ReadonlySet<EntityKind> = new Set([
  "component",
  "label",
  "junction",
]);

export function capturePointer(
  canvas: HTMLCanvasElement,
  pointerId: number,
): void {
  try {
    canvas.setPointerCapture(pointerId);
  } catch {
    // happy-dom doesn't implement pointer capture; harmless.
  }
}

export function releasePointer(
  canvas: HTMLCanvasElement,
  pointerId: number,
): void {
  try {
    canvas.releasePointerCapture(pointerId);
  } catch {
    // pointer already released
  }
}

/**
 * Resize / rotate handles live inside the owning shape's TransformNode
 * chain. The owner is the first ancestor whose `name` matches the
 * `om-component:` / `om-connector:` pattern.
 */
export function ownerOfHandle(start: Node | null): string | null {
  let cur: Node | null = start;
  while (cur) {
    const m = cur.name?.match(/^om-(component|connector):(.*)$/);
    if (m) {
      return formatKey(m[1] as EntityKind, m[2] ?? "");
    }
    cur = cur.parent;
  }
  return null;
}

/**
 * Port indicator meshes carry `metadata.kind = "port"` but are parented
 * inside the connector's TransformNode. Resolve the owning connector via
 * `entityKeyForNode` so nested connectors pick up the parent-component
 * prefix (`k:R1.p`) instead of colliding on the bare port name (`k:p`).
 */
export function ownerOfPort(start: Node | null): string | null {
  const entity = entityKeyForNode(start?.parent ?? null);
  if (!entity || entity.kind !== "connector") {
    return null;
  }
  return formatKey("connector", entity.nodeId);
}
