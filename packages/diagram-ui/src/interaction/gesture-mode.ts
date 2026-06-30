import type { Container } from "pixi.js";

import {
  entityKeyForNode,
  formatKey,
  type EntityKey,
  type EntityKind,
} from "./node-keys.js";

export type Picker = (clientX: number, clientY: number) => Container | null;
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
  /**
   * Drag of a poly shape's vertex handle. `key` is the self-describing vertex
   * wire key (`vtx:<shapeKind>:<shapeIndex>/<vertexIndex>`); `x, y` is the
   * live pointer in diagram coords. Draft on every move, committed on
   * pointerup.
   */
  vertexDrag: {
    key: string;
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
   * is the live cursor position in diagram coords. `fromPoint` is the
   * source connector's diagram position and `compat` the local
   * type/causality check vs the snap target — both resolved by the mode
   * (which already needs them to draw the wire) so the host doesn't
   * recompute them. `commit=false` while dragging; `commit=true` on
   * pointerup. When committed and `toKey` is present with a passing
   * `compat`, the host treats it as a connection-create request.
   */
  connection: {
    from: string;
    to: { x: number; y: number };
    toKey: string | null;
    fromPoint: { x: number; y: number };
    compat: { ok: boolean; reason?: string } | null;
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
  node: Container | null;
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
  /** Abandon an in-flight gesture without committing — drops any transient
   *  mesh the mode owns. Called when the router is destroyed mid-gesture. */
  cancel?(): void;
}

/**
 * Entity kinds that begin a move-drag. Connectors are deliberately
 * excluded: clicking anywhere on a connector starts a connection drag
 * instead, matching OMEdit.
 */
export const MOVE_KINDS: ReadonlySet<EntityKind> = new Set([
  "component",
  "shape",
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
 * Resize / rotate handles live inside the owning shape's container chain.
 * The owner is the first ancestor whose `label` matches the
 * `om-component:` / `om-connector:` / `om-shape:` pattern.
 */
export function ownerOfHandle(start: Container | null): string | null {
  let cur: Container | null = start;
  while (cur) {
    const m = cur.label?.match(/^om-(component|connector|shape):(.*)$/);
    if (m) {
      return formatKey(m[1] as EntityKind, m[2] ?? "");
    }
    cur = cur.parent;
  }
  return null;
}

/**
 * Port indicator containers carry `kind: "port"` identity but are parented
 * inside the connector's container. Resolve the owning connector via
 * `entityKeyForNode` so nested connectors pick up the parent-component
 * prefix (`k:R1.p`) instead of colliding on the bare port name (`k:p`).
 */
export function ownerOfPort(start: Container | null): string | null {
  const entity = entityKeyForNode(start?.parent ?? null);
  if (!entity || entity.kind !== "connector") {
    return null;
  }
  return formatKey("connector", entity.nodeId);
}
