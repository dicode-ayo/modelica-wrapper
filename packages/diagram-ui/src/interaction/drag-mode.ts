import { DRAG_SLOP_PX } from "./interaction-manager.js";
import { formatKey, vertexKeyForEntity } from "./entity-keys.js";
import {
  MOVE_KINDS,
  ownerOfHandle,
  type DiagramPoint,
  type DragEmit,
  type GestureMode,
  type GestureStart,
} from "./gesture-mode.js";

type Corner = "tl" | "tr" | "bl" | "br";

function asCorner(id: string): Corner | null {
  switch (id) {
    case "tl":
    case "tr":
    case "bl":
    case "br":
      return id;
    default:
      return null;
  }
}

interface MoveState {
  kind: "move";
  startX: number;
  startY: number;
  keys: string[];
}

interface ResizeState {
  kind: "resize";
  key: string;
  corner: Corner;
}

interface RotateState {
  kind: "rotate";
  key: string;
}

interface VertexState {
  kind: "vertex";
  /** The vertex wire key (`vtx:<shapeKind>:<shapeIndex>/<vertexIndex>`). */
  key: string;
}

interface EdgeState {
  kind: "edge";
  connIdx: number;
  startX: number;
  startY: number;
}

type DragState =
  | MoveState
  | ResizeState
  | RotateState
  | VertexState
  | EdgeState;

/**
 * Manipulating existing entities: move (one or the whole selection),
 * resize from a corner handle, rotate from the rotate handle, and
 * edge-segment drag. `begin` picks the sub-gesture from what was hit;
 * `move`/`edge` emit only once the pointer moves, `resize`/`rotate` emit
 * a draft immediately so the handle tracks from the first pixel.
 */
export class DragMode implements GestureMode {
  readonly id = "drag";
  private state: DragState | null = null;
  private pressClient: { x: number; y: number } | null = null;

  constructor(private readonly emit: DragEmit) {}

  /** True when the press never travelled far enough to have been a drag. */
  private withinSlop(e: PointerEvent): boolean {
    const press = this.pressClient;
    if (press === null) return false;
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    return dx * dx + dy * dy <= DRAG_SLOP_PX * DRAG_SLOP_PX;
  }

  begin(start: GestureStart): boolean {
    const { entity, node, point: pt, shiftKey } = start;
    this.pressClient = { x: start.clientX, y: start.clientY };
    if (!entity) {
      return false;
    }

    if (entity.kind === "rotate-handle") {
      const ownerKey = ownerOfHandle(node);
      if (!ownerKey) {
        return false;
      }
      this.state = { kind: "rotate", key: ownerKey };
      this.emit("rotate", {
        key: ownerKey,
        x: pt.x,
        y: pt.y,
        free: shiftKey,
        draft: true,
      });
      return true;
    }

    if (entity.kind === "handle") {
      const corner = asCorner(entity.nodeId);
      if (!corner) {
        return false;
      }
      const ownerKey = ownerOfHandle(node);
      if (!ownerKey) {
        return false;
      }
      this.state = { kind: "resize", key: ownerKey, corner };
      this.emit("resize", {
        key: ownerKey,
        corner,
        x: pt.x,
        y: pt.y,
        draft: true,
      });
      return true;
    }

    if (entity.kind === "vertex-handle") {
      const key = vertexKeyForEntity(entity);
      if (!key) {
        return false;
      }
      this.state = { kind: "vertex", key };
      this.emit("vertexDrag", { key, x: pt.x, y: pt.y, draft: true });
      return true;
    }

    if (MOVE_KINDS.has(entity.kind)) {
      const key = formatKey(entity.kind, entity.nodeId);
      const selection = start.getSelectionKeys();
      // If the clicked key is already selected, drag the whole selection.
      const keys = selection.includes(key) ? selection : [key];
      this.state = { kind: "move", startX: pt.x, startY: pt.y, keys };
      return true;
    }

    if (entity.kind === "edge") {
      const connIdx = Number(entity.nodeId);
      if (Number.isNaN(connIdx)) {
        return false;
      }
      this.state = { kind: "edge", connIdx, startX: pt.x, startY: pt.y };
      return true;
    }

    return false;
  }

  update(point: DiagramPoint, e: PointerEvent): void {
    if (this.state) {
      this.emitFor(this.state, point, e, true);
    }
  }

  commit(point: DiagramPoint, e: PointerEvent): void {
    if (!this.state) {
      return;
    }
    const state = this.state;
    this.state = null;
    // A press inside the slop was a click — the second press of a double-click
    // is the one that matters. It ends the gesture without a commit, so none of
    // the mouse-up passes run: no grid snap onto an off-grid entity, no angle
    // snap onto a freely rotated one. The host still hears about it, because
    // `resize`/`rotate`/`vertex` draft from `begin` and something has to drop
    // that draft.
    if (this.withinSlop(e)) {
      this.emit("dragCancel", {});
      return;
    }
    this.emitFor(state, point, e, false);
  }

  private emitFor(
    state: DragState,
    pt: DiagramPoint,
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
      case "vertex":
        this.emit("vertexDrag", {
          key: state.key,
          x: pt.x,
          y: pt.y,
          draft,
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
}
