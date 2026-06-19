import {
  Color3,
  CreateGreasedLine,
  Vector3,
  type AbstractMesh,
  type Scene,
  type TransformNode,
} from "@babylonjs/core";

import { requestSceneRender } from "../scene/render-scheduler.js";
import { buildEdge } from "../connection/edge-build.js";
import { orthogonalRoute } from "../interaction/connection-route.js";

/** Wire colour while hovering empty space or a compatible target. */
export const CONNECT_OK_COLOR = new Color3(0.231, 0.51, 0.965); // #3b82f6
/** Wire colour when the snap target is rejected by `canConnect`. */
export const CONNECT_BAD_COLOR = new Color3(0.937, 0.267, 0.267); // #ef4444

const RUBBER_BAND_COLOR = new Color3(0.38, 0.6, 0.98);

interface DiagramPoint {
  x: number;
  y: number;
}

interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Transient feedback the active gesture draws while in flight: the
 * connection-routing wire and the rubber-band selection rectangle. Each
 * mode owns its own visual through this handle and clears it on commit;
 * the meshes live under `diagramRoot` so they inherit pan/zoom. Cheap to
 * rebuild — geometry is disposed and recreated on each update, the same
 * way `SelectionOutline` does.
 */
export class GestureOverlay {
  private wire: AbstractMesh | null = null;
  private rect: AbstractMesh | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode,
  ) {}

  showWire(from: DiagramPoint, to: DiagramPoint, color: Color3): void {
    this.wire?.dispose();
    this.wire = null;
    const meshes = buildEdge(this.scene, this.parent, "om-gesture-wire", {
      points: orthogonalRoute(from, to),
      color,
    });
    if (!meshes) {
      return;
    }
    // The overlay is feedback-only: the pick tube would shadow the real
    // entities under the cursor mid-gesture, so drop it.
    meshes.hitArea.dispose();
    meshes.line.isPickable = false;
    this.wire = meshes.line;
    requestSceneRender(this.scene);
  }

  hideWire(): void {
    if (!this.wire) {
      return;
    }
    this.wire.dispose();
    this.wire = null;
    requestSceneRender(this.scene);
  }

  showRect(rect: Rect): void {
    this.rect?.dispose();
    // Slight -Z bias keeps the outline above the component icons (camera
    // sits on +Z).
    const z = -0.01;
    const points = [
      new Vector3(rect.x1, rect.y1, z),
      new Vector3(rect.x2, rect.y1, z),
      new Vector3(rect.x2, rect.y2, z),
      new Vector3(rect.x1, rect.y2, z),
      new Vector3(rect.x1, rect.y1, z),
    ];
    const line = CreateGreasedLine(
      "om-rubber-band",
      { points },
      { width: 2, sizeAttenuation: true, color: RUBBER_BAND_COLOR },
      this.scene,
    );
    line.parent = this.parent;
    line.isPickable = false;
    this.rect = line;
    requestSceneRender(this.scene);
  }

  hideRect(): void {
    if (!this.rect) {
      return;
    }
    this.rect.dispose();
    this.rect = null;
    requestSceneRender(this.scene);
  }

  dispose(): void {
    this.wire?.dispose();
    this.rect?.dispose();
    this.wire = null;
    this.rect = null;
  }
}
