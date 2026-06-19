import {
  Color3,
  CreateLines,
  Vector3,
  type AbstractMesh,
  type LinesMesh,
  type Scene,
  type TransformNode,
} from "@babylonjs/core";

import { requestSceneRender } from "../scene/render-scheduler.js";
import { buildEdge } from "../connection/edge-build.js";
import { orthogonalRoute } from "../interaction/connection-route.js";

/**
 * Builders for the transient meshes a gesture draws while in flight. Each
 * interaction mode owns its own mesh and calls these — there is no shared
 * overlay object to accumulate per-gesture methods as new tools (drawing,
 * waypoints) arrive. The meshes are feedback-only (`isPickable = false`)
 * and parent to `diagramRoot` so they inherit pan/zoom; callers own
 * disposal via {@link disposeOverlayMesh}.
 */

/** Wire colour while hovering empty space or a compatible target. */
export const CONNECT_OK_COLOR = new Color3(0.231, 0.51, 0.965); // #3b82f6
/** Wire colour when the snap target is rejected by `canConnect`. */
export const CONNECT_BAD_COLOR = new Color3(0.937, 0.267, 0.267); // #ef4444
/** Accent blue shared by the rubber-band and the selection outline. */
export const OVERLAY_BLUE = new Color3(0.38, 0.6, 0.98);

/** Z-bias lifting overlay strokes just above the component icons (camera
 *  sits on +Z, so negative is closer). */
const OVERLAY_Z = -0.01;

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
 * Dispose a transient overlay mesh and its material; tolerant of null.
 * The `(false, true)` releases the per-build material so a gesture that
 * rebuilds every pointermove doesn't accrue orphaned materials. Requests
 * a render — rendering is on-demand, so without this the disposed mesh
 * would linger on screen until an unrelated frame.
 */
export function disposeOverlayMesh(mesh: AbstractMesh | null): void {
  if (!mesh) {
    return;
  }
  const scene = mesh.getScene();
  mesh.dispose(false, true);
  requestSceneRender(scene);
}

/**
 * Build an orthogonal-routed feedback wire between two diagram points.
 * The pick tube `buildEdge` produces is dropped — the wire must not
 * shadow the real entities under the cursor mid-gesture.
 */
export function buildWireMesh(
  scene: Scene,
  parent: TransformNode,
  from: DiagramPoint,
  to: DiagramPoint,
  color: Color3,
): AbstractMesh | null {
  const meshes = buildEdge(scene, parent, "om-gesture-wire", {
    points: orthogonalRoute(from, to),
    color,
  });
  if (!meshes) {
    return null;
  }
  meshes.hitArea.dispose(false, true);
  meshes.line.isPickable = false;
  requestSceneRender(scene);
  return meshes.line;
}

function rectPoints(rect: Rect): Vector3[] {
  return [
    new Vector3(rect.x1, rect.y1, OVERLAY_Z),
    new Vector3(rect.x2, rect.y1, OVERLAY_Z),
    new Vector3(rect.x2, rect.y2, OVERLAY_Z),
    new Vector3(rect.x1, rect.y2, OVERLAY_Z),
    new Vector3(rect.x1, rect.y1, OVERLAY_Z),
  ];
}

/**
 * Build a rubber-band rectangle outline. Its 5-point topology never
 * changes, so the gesture builds it once and updates it in place with
 * {@link updateRectMesh} — recreating the mesh every pointermove flickers.
 */
export function buildRectMesh(
  scene: Scene,
  parent: TransformNode,
  rect: Rect,
  color: Color3 = OVERLAY_BLUE,
): LinesMesh {
  const line = CreateLines(
    "om-rubber-band",
    { points: rectPoints(rect), updatable: true },
    scene,
  );
  line.color = color;
  line.parent = parent;
  line.isPickable = false;
  requestSceneRender(scene);
  return line;
}

/** Rewrite the rubber-band's corners in place via the `instance` param —
 *  no dispose/rebuild, so the outline tracks the cursor without flicker. */
export function updateRectMesh(mesh: LinesMesh, rect: Rect): void {
  const scene = mesh.getScene();
  CreateLines(
    mesh.name,
    { points: rectPoints(rect), updatable: true, instance: mesh },
    scene,
  );
  requestSceneRender(scene);
}
