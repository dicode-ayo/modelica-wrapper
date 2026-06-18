import { entityKeyForNode, formatKey } from "./node-keys.js";
import {
  ownerOfPort,
  type DiagramPoint,
  type DragEmit,
  type GestureMode,
  type GestureStart,
  type Picker,
} from "./gesture-mode.js";

/**
 * Routing: pull a wire from a connector's port. Snaps `toKey` to a
 * connector under the cursor (never the source), and commits a
 * connection-create request on release when a target was found.
 */
export class ConnectMode implements GestureMode {
  readonly id = "connect";
  private fromKey: string | null = null;

  constructor(
    private readonly picker: Picker,
    private readonly emit: DragEmit,
  ) {}

  begin(start: GestureStart): boolean {
    const entity = start.entity;
    if (entity?.kind !== "port" && entity?.kind !== "connector") {
      return false;
    }
    const ownerKey =
      entity.kind === "port"
        ? ownerOfPort(start.node)
        : formatKey("connector", entity.nodeId);
    if (!ownerKey) {
      return false;
    }
    this.fromKey = ownerKey;
    this.emit("connection", {
      from: ownerKey,
      to: { x: start.point.x, y: start.point.y },
      toKey: null,
      commit: false,
    });
    return true;
  }

  update(point: DiagramPoint, e: PointerEvent): void {
    if (this.fromKey === null) {
      return;
    }
    this.emit("connection", {
      from: this.fromKey,
      to: point,
      toKey: this.snapKey(e, this.fromKey),
      commit: false,
    });
  }

  commit(point: DiagramPoint, e: PointerEvent): void {
    if (this.fromKey === null) {
      return;
    }
    const from = this.fromKey;
    this.fromKey = null;
    this.emit("connection", {
      from,
      to: point,
      toKey: this.snapKey(e, from),
      commit: true,
    });
  }

  private snapKey(e: PointerEvent, excludeKey: string): string | null {
    const node = this.picker(e.clientX, e.clientY);
    const entity = node ? entityKeyForNode(node) : null;
    if (!entity || entity.kind !== "connector") {
      return null;
    }
    const key = formatKey("connector", entity.nodeId);
    return key === excludeKey ? null : key;
  }
}
