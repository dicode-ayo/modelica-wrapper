import type { Node } from "@babylonjs/core";

import { entityKeyForNode, formatKey, type EntityKind } from "./node-keys.js";

/**
 * Drag controller: turns canvas pointer gestures into drag-events for
 * the host element. Three kinds of drag:
 *
 *  - `move`         : primary-button down on a component / connector /
 *                     label / junction entity → emits `drag` events
 *                     with `dx, dy` deltas in diagram coords.
 *
 *  - `resize`       : primary-button down on a resize handle. Emits
 *                     `resize` events with `corner, x, y` in diagram
 *                     coords.
 *
 *  - `rotate`       : primary-button down on a rotate handle. Emits
 *                     `rotate` events with the pointer `x, y` and the
 *                     `free` (Shift) modifier; the host derives the angle.
 *
 *  - `rubber-band`  : primary-button down on empty space (no entity
 *                     and not a pan modifier). Emits `rubberBand`
 *                     events with the dragged-out rectangle.
 *
 *  - `edge`         : primary-button down on a connection's edge line.
 *                     Emits `edgeDrag` events with the grab point and
 *                     cumulative delta; the host moves the grabbed
 *                     segment orthogonally.
 *
 * The controller is renderer-agnostic: callers inject:
 *   - `picker(clientX, clientY) -> Node` — typically wraps scene.pick
 *   - `clientToDiagram(clientX, clientY) -> {x, y}` — typically the
 *     scene element's coord converter
 *
 * All drags emit `draft=true` events on every pointermove and a final
 * `draft=false` event on pointerup. Callers can use `draft=true` to
 * stage UI changes against a draftLayout and apply `draft=false` to
 * the committed layout.
 */

export type Picker = (clientX: number, clientY: number) => Node | null;
export type ClientToDiagram = (
  clientX: number,
  clientY: number,
) => { x: number; y: number } | null;

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

/** Returned by `getSelectionKeys` so the controller knows what to move. */
export type SelectionProvider = () => string[];

interface MoveState {
  kind: "move";
  startX: number;
  startY: number;
  keys: string[];
}

interface ResizeState {
  kind: "resize";
  key: string;
  corner: "tl" | "tr" | "bl" | "br";
}

interface RotateState {
  kind: "rotate";
  key: string;
}

interface RubberBandState {
  kind: "rubber-band";
  startX: number;
  startY: number;
}

interface ConnectionState {
  kind: "connection";
  fromKey: string;
}

interface EdgeDragState {
  kind: "edge";
  connIdx: number;
  startX: number;
  startY: number;
}

type DragState =
  | MoveState
  | ResizeState
  | RotateState
  | RubberBandState
  | ConnectionState
  | EdgeDragState;

/**
 * Entity kinds that begin a move-drag on pointerdown. Connectors are
 * deliberately excluded: clicking *anywhere* on a connector starts a
 * connection-drag instead, matching OMEdit. The port-indicator disc
 * was acting as the entire hit target before this — fine for a slow,
 * precise click, but the 22%-of-icon disc is hard to land on with a
 * fast cursor move. Nested connectors are positioned by their parent
 * component anyway, so losing the move gesture costs nothing.
 */
const MOVE_KINDS: ReadonlySet<EntityKind> = new Set([
  "component",
  "label",
  "junction",
]);

export class DragController {
  private state: DragState | null = null;
  private pointerId = -1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly picker: Picker,
    private readonly clientToDiagram: ClientToDiagram,
    private readonly getSelectionKeys: SelectionProvider,
    private readonly emit: DragEmit,
  ) {
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
  }

  destroy(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
  }

  /**
   * True from the moment a drag-committed `pointerdown` lands (move /
   * resize / connection / rubber-band) until `pointerup` releases.
   *
   * Important: this flips earlier than the host's interaction-state
   * machine, which only transitions to `"moving"` / etc. after the
   * first `drag` event is emitted. The `InteractionManager`'s
   * `pointermove` listener is registered before ours, so its hover
   * emit races ahead of our state transition on the first move of a
   * drag — host code that wants to suppress hover side-effects during
   * a drag must gate on this flag, not on the interaction-store state.
   */
  get isActive(): boolean {
    return this.state !== null;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || e.shiftKey) {
      // primary + no shift: shift+primary is the pan modifier (see PanZoom).
      // We still allow shift+primary on empty space to extend rubber-band
      // selection — but the InteractionManager guards selection via the
      // same shift check. Keeping this simple: drag only on plain primary.
      return;
    }
    const node = this.picker(e.clientX, e.clientY);
    const entity = node ? entityKeyForNode(node) : null;
    const pt = this.clientToDiagram(e.clientX, e.clientY);
    if (!pt) {
      return;
    }

    if (entity?.kind === "port" || entity?.kind === "connector") {
      // Both port indicator and the bare connector icon resolve to a
      // connection drag. The port path goes through `ownerOfPort` to
      // walk past the indicator mesh; the connector path uses the
      // entity directly because `entityKeyForNode` already returned
      // a qualified key (`R1.p` for nested).
      const ownerKey =
        entity.kind === "port"
          ? ownerOfPort(node)
          : formatKey("connector", entity.nodeId);
      if (!ownerKey) {
        return;
      }
      this.state = { kind: "connection", fromKey: ownerKey };
      this.pointerId = e.pointerId;
      capture(this.canvas, e.pointerId);
      this.emit("connection", {
        from: ownerKey,
        to: { x: pt.x, y: pt.y },
        toKey: null,
        commit: false,
      });
      return;
    }

    if (entity?.kind === "rotate-handle") {
      const ownerKey = ownerOfHandle(node, entity.nodeId);
      if (!ownerKey) {
        return;
      }
      this.state = { kind: "rotate", key: ownerKey };
      this.pointerId = e.pointerId;
      capture(this.canvas, e.pointerId);
      this.emit("rotate", {
        key: ownerKey,
        x: pt.x,
        y: pt.y,
        free: e.shiftKey,
        draft: true,
      });
      return;
    }

    if (entity?.kind === "handle") {
      const corner = entity.nodeId as "tl" | "tr" | "bl" | "br";
      // Find the owning shape key by walking up the picked node.
      const ownerKey = ownerOfHandle(node, entity.nodeId);
      if (!ownerKey) {
        return;
      }
      this.state = { kind: "resize", key: ownerKey, corner };
      this.pointerId = e.pointerId;
      capture(this.canvas, e.pointerId);
      this.emit("resize", {
        key: ownerKey,
        corner,
        x: pt.x,
        y: pt.y,
        draft: true,
      });
      return;
    }

    if (entity && MOVE_KINDS.has(entity.kind)) {
      const key = formatKey(entity.kind, entity.nodeId);
      const selection = this.getSelectionKeys();
      // If the clicked key is already selected, drag the whole selection.
      const keys = selection.includes(key) ? selection : [key];
      this.state = {
        kind: "move",
        startX: pt.x,
        startY: pt.y,
        keys,
      };
      this.pointerId = e.pointerId;
      capture(this.canvas, e.pointerId);
      return;
    }

    if (entity?.kind === "edge") {
      // Clicking on an edge selects it (the InteractionManager fires
      // the select event in parallel) and starts an edge-segment drag:
      // the host moves the grabbed segment orthogonally, inserting
      // waypoints to keep the route Manhattan.
      const connIdx = Number(entity.nodeId);
      if (Number.isNaN(connIdx)) {
        return;
      }
      this.state = { kind: "edge", connIdx, startX: pt.x, startY: pt.y };
      this.pointerId = e.pointerId;
      capture(this.canvas, e.pointerId);
      return;
    }

    // Empty-space click: rubber-band start.
    this.state = {
      kind: "rubber-band",
      startX: pt.x,
      startY: pt.y,
    };
    this.pointerId = e.pointerId;
    capture(this.canvas, e.pointerId);
    this.emit("rubberBand", {
      rect: { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y },
      draft: true,
    });
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.state || e.pointerId !== this.pointerId) {
      return;
    }
    const pt = this.clientToDiagram(e.clientX, e.clientY);
    if (!pt) {
      return;
    }
    this.emitDragEvent(this.state, pt, e, true);
  };

  /**
   * Emit the drag event for `state` at pointer position `pt`. `draft`
   * distinguishes the live move (`true`) from the committing pointerup
   * (`false`); the connection drag spells the same distinction as its
   * `commit` flag.
   */
  private emitDragEvent(
    state: DragState,
    pt: { x: number; y: number },
    e: PointerEvent,
    draft: boolean,
  ): void {
    switch (state.kind) {
      case "move":
        this.emit("drag", {
          keys: state.keys,
          dx: pt.x - state.startX,
          dy: pt.y - state.startY,
          draft,
        });
        return;
      case "resize":
        this.emit("resize", {
          key: state.key,
          corner: state.corner,
          x: pt.x,
          y: pt.y,
          draft,
        });
        return;
      case "rotate":
        this.emit("rotate", {
          key: state.key,
          x: pt.x,
          y: pt.y,
          free: e.shiftKey,
          draft,
        });
        return;
      case "rubber-band":
        this.emit("rubberBand", {
          rect: { x1: state.startX, y1: state.startY, x2: pt.x, y2: pt.y },
          draft,
        });
        return;
      case "connection":
        this.emit("connection", {
          from: state.fromKey,
          to: { x: pt.x, y: pt.y },
          toKey: this.snapKey(e.clientX, e.clientY, state.fromKey),
          commit: !draft,
        });
        return;
      case "edge":
        this.emit("edgeDrag", {
          connIdx: state.connIdx,
          grab: { x: state.startX, y: state.startY },
          dx: pt.x - state.startX,
          dy: pt.y - state.startY,
          draft,
        });
        return;
    }
  }

  private snapKey(
    clientX: number,
    clientY: number,
    excludeKey: string,
  ): string | null {
    const node = this.picker(clientX, clientY);
    const entity = node ? entityKeyForNode(node) : null;
    if (!entity) {
      return null;
    }
    if (entity.kind !== "connector") {
      // Snap target must be a connector (we picked through the port
      // indicator originally — its `node` resolves to the connector).
      return null;
    }
    const key = formatKey(entity.kind, entity.nodeId);
    return key === excludeKey ? null : key;
  }

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (!this.state || e.pointerId !== this.pointerId) {
      return;
    }
    const pt = this.clientToDiagram(e.clientX, e.clientY) ?? {
      x: 0,
      y: 0,
    };
    const state = this.state;
    this.state = null;
    this.pointerId = -1;
    release(this.canvas, e.pointerId);
    this.emitDragEvent(state, pt, e, false);
  };
}

function capture(canvas: HTMLCanvasElement, pointerId: number): void {
  try {
    canvas.setPointerCapture(pointerId);
  } catch {
    // happy-dom doesn't implement pointer capture; harmless.
  }
}

function release(canvas: HTMLCanvasElement, pointerId: number): void {
  try {
    canvas.releasePointerCapture(pointerId);
  } catch {
    // pointer already released
  }
}

/**
 * Resize handles carry `metadata.kind = "handle"` and live inside the
 * owning shape's TransformNode chain. The owner is the first ancestor
 * whose `name` matches the `om-component:` / `om-connector:` pattern.
 */
function ownerOfHandle(start: Node | null, _corner: string): string | null {
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
 * Port indicator meshes carry `metadata.kind = "port"` but they're
 * physically parented inside the connector's TransformNode. Resolve
 * the owning connector via `entityKeyForNode` so nested connectors
 * pick up the parent-component prefix (`k:R1.p`) instead of colliding
 * on the bare port name (`k:p`).
 */
function ownerOfPort(start: Node | null): string | null {
  const entity = entityKeyForNode(start?.parent ?? null);
  if (!entity || entity.kind !== "connector") {
    return null;
  }
  return formatKey("connector", entity.nodeId);
}
