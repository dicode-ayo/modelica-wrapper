import type { Container, Graphics } from "pixi.js";

import { formatKey } from "./entity-keys.js";
import { entityKeyForNode } from "./node-keys.js";
import {
  ownerOfPort,
  type CompatCheck,
  type ConnectorPosition,
  type DiagramPoint,
  type DragEmit,
  type GestureMode,
  type GestureStart,
  type Picker,
} from "./gesture-mode.js";
import {
  buildWireMesh,
  disposeOverlayMesh,
  CONNECT_BAD_COLOR,
  CONNECT_OK_COLOR,
} from "../base/overlay-mesh.js";

/**
 * Routing: pull a wire from a connector's port. Snaps `toKey` to a
 * connector under the cursor (never the source), and commits a
 * connection-create request on release when a target was found. Owns and
 * draws the live routing wire (blue, red over an incompatible target);
 * the host still consumes the emitted `connection` events for the commit
 * and the port indicators.
 */
export class ConnectMode implements GestureMode {
  readonly id = "connect";
  private fromKey: string | null = null;
  private fromPoint: DiagramPoint | null = null;
  private wire: Graphics | null = null;

  constructor(
    private readonly picker: Picker,
    private readonly emit: DragEmit,
    private readonly parent: Container,
    private readonly connectorPosition: ConnectorPosition,
    private readonly evaluateCompat: CompatCheck,
  ) {}

  private drawWire(to: DiagramPoint, color: number): void {
    if (!this.fromPoint) {
      return;
    }
    disposeOverlayMesh(this.wire);
    this.wire = buildWireMesh(this.parent, this.fromPoint, to, color);
  }

  private clearWire(): void {
    disposeOverlayMesh(this.wire);
    this.wire = null;
  }

  cancel(): void {
    this.fromKey = null;
    this.fromPoint = null;
    this.clearWire();
  }

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
    this.fromPoint = this.connectorPosition(ownerKey) ?? {
      x: start.point.x,
      y: start.point.y,
    };
    this.drawWire(start.point, CONNECT_OK_COLOR);
    this.emit("connection", {
      from: ownerKey,
      to: { x: start.point.x, y: start.point.y },
      toKey: null,
      fromPoint: this.fromPoint,
      compat: null,
      commit: false,
    });
    return true;
  }

  update(point: DiagramPoint, e: PointerEvent): void {
    if (this.fromKey === null || this.fromPoint === null) {
      return;
    }
    const toKey = this.snapKey(e, this.fromKey);
    const compat = this.evaluateCompat(this.fromKey, toKey);
    this.drawWire(
      point,
      compat && !compat.ok ? CONNECT_BAD_COLOR : CONNECT_OK_COLOR,
    );
    this.emit("connection", {
      from: this.fromKey,
      to: point,
      toKey,
      fromPoint: this.fromPoint,
      compat,
      commit: false,
    });
  }

  commit(point: DiagramPoint, e: PointerEvent): void {
    if (this.fromKey === null || this.fromPoint === null) {
      return;
    }
    const from = this.fromKey;
    const fromPoint = this.fromPoint;
    const toKey = this.snapKey(e, from);
    const compat = this.evaluateCompat(from, toKey);
    this.fromKey = null;
    this.fromPoint = null;
    this.clearWire();
    this.emit("connection", {
      from,
      to: point,
      toKey,
      fromPoint,
      compat,
      commit: true,
    });
  }

  private snapKey(e: PointerEvent, excludeKey: string): string | null {
    const node = this.picker(e.clientX, e.clientY);
    const entity = node ? entityKeyForNode(node) : null;
    if (!entity) {
      return null;
    }
    // A drop can land on the target's port disc as well as its body — the
    // disc sits at the connector's centre, exactly where a route terminates.
    const key =
      entity.kind === "connector"
        ? formatKey("connector", entity.nodeId)
        : entity.kind === "port"
          ? ownerOfPort(node)
          : null;
    if (key === null) {
      return null;
    }
    return key === excludeKey ? null : key;
  }
}
