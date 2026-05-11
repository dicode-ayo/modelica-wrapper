import type { Node } from "@babylonjs/core";

import {
  entityKeyForNode,
  formatKey,
  type EntityKind,
} from "./node-keys.js";

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
 *  - `rubber-band`  : primary-button down on empty space (no entity
 *                     and not a pan modifier). Emits `rubberBand`
 *                     events with the dragged-out rectangle.
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

interface RubberBandState {
  kind: "rubber-band";
  startX: number;
  startY: number;
}

interface ConnectionState {
  kind: "connection";
  fromKey: string;
}

type DragState =
  | MoveState
  | ResizeState
  | RubberBandState
  | ConnectionState;

const MOVE_KINDS: ReadonlySet<EntityKind> = new Set([
  "component",
  "connector",
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

    if (entity?.kind === "port") {
      const ownerKey = ownerOfPort(node);
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
    switch (this.state.kind) {
      case "move":
        this.emit("drag", {
          keys: this.state.keys,
          dx: pt.x - this.state.startX,
          dy: pt.y - this.state.startY,
          draft: true,
        });
        return;
      case "resize":
        this.emit("resize", {
          key: this.state.key,
          corner: this.state.corner,
          x: pt.x,
          y: pt.y,
          draft: true,
        });
        return;
      case "rubber-band":
        this.emit("rubberBand", {
          rect: {
            x1: this.state.startX,
            y1: this.state.startY,
            x2: pt.x,
            y2: pt.y,
          },
          draft: true,
        });
        return;
      case "connection":
        this.emit("connection", {
          from: this.state.fromKey,
          to: { x: pt.x, y: pt.y },
          toKey: this.snapKey(e.clientX, e.clientY, this.state.fromKey),
          commit: false,
        });
        return;
    }
  };

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
    switch (state.kind) {
      case "move":
        this.emit("drag", {
          keys: state.keys,
          dx: pt.x - state.startX,
          dy: pt.y - state.startY,
          draft: false,
        });
        return;
      case "resize":
        this.emit("resize", {
          key: state.key,
          corner: state.corner,
          x: pt.x,
          y: pt.y,
          draft: false,
        });
        return;
      case "rubber-band":
        this.emit("rubberBand", {
          rect: {
            x1: state.startX,
            y1: state.startY,
            x2: pt.x,
            y2: pt.y,
          },
          draft: false,
        });
        return;
      case "connection":
        this.emit("connection", {
          from: state.fromKey,
          to: { x: pt.x, y: pt.y },
          toKey: this.snapKey(e.clientX, e.clientY, state.fromKey),
          commit: true,
        });
        return;
    }
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
 * physically parented inside the connector's TransformNode. Walk up
 * looking for the nearest `om-connector:` ancestor and return its key.
 */
function ownerOfPort(start: Node | null): string | null {
  let cur: Node | null = start;
  while (cur) {
    const m = cur.name?.match(/^om-connector:(.*)$/);
    if (m) {
      return `k:${m[1] ?? ""}`;
    }
    cur = cur.parent;
  }
  return null;
}
