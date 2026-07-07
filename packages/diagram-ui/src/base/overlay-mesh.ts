import { Container, Graphics } from "pixi.js";

import { requestSceneRender } from "../scene/render-scheduler.js";
import { orthogonalRoute } from "../interaction/connection-route.js";

/**
 * Builders for the transient `Graphics` a gesture draws while in flight.
 * Each interaction mode owns its own object and calls these — there is no
 * shared overlay accumulating per-gesture methods as new tools (drawing,
 * waypoints) arrive. The strokes are feedback-only (`eventMode = "none"`)
 * and parent to `diagramRoot` so they inherit pan/zoom; callers own
 * disposal via {@link disposeOverlayMesh}.
 */

/** Wire colour while hovering empty space or a compatible target (#3b82f6). */
export const CONNECT_OK_COLOR = 0x3b82f6;
/** Wire colour when the snap target is rejected by `canConnect` (#ef4444). */
export const CONNECT_BAD_COLOR = 0xef4444;
/** Accent blue shared by the rubber-band and the selection outline. */
export const OVERLAY_BLUE = 0x6199fa;

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

/** Colour each rubber-band carries, so an in-place update redraws it
 *  without the caller re-supplying the colour. */
const rectColor = new WeakMap<Graphics, number>();

/** Topmost ancestor of `node` — the stage container the render scheduler
 *  is keyed by. Lets a detached helper request a repaint without holding
 *  the scene context. */
function rootOf(node: Container): Container {
  let cur: Container = node;
  while (cur.parent) {
    cur = cur.parent;
  }
  return cur;
}

/**
 * Dispose a transient overlay graphic; tolerant of null. Requests a render
 * — rendering is on-demand, so without this the disposed graphic would
 * linger on screen until an unrelated frame.
 */
export function disposeOverlayMesh(mesh: Graphics | null): void {
  if (!mesh) {
    return;
  }
  const root = rootOf(mesh);
  mesh.destroy();
  requestSceneRender(root);
}

/**
 * Build an orthogonal-routed feedback wire between two diagram points — a
 * crisp 1-pixel stroke that never shadows the real entities under the
 * cursor (`eventMode = "none"`).
 */
export function buildWireMesh(
  parent: Container,
  from: DiagramPoint,
  to: DiagramPoint,
  color: number,
): Graphics | null {
  const points = orthogonalRoute(from, to);
  const first = points[0];
  if (first === undefined || points.length < 2) {
    return null;
  }
  const wire = new Graphics({ label: "om-gesture-wire" });
  wire.eventMode = "none";
  wire.moveTo(first[0], first[1]);
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p === undefined) {
      continue;
    }
    wire.lineTo(p[0], p[1]);
  }
  wire.stroke({ width: 1, color, pixelLine: true, alignment: 0.5 });
  parent.addChild(wire);
  requestSceneRender(rootOf(wire));
  return wire;
}

function drawRect(g: Graphics, rect: Rect, color: number): void {
  g.clear();
  g.moveTo(rect.x1, rect.y1)
    .lineTo(rect.x2, rect.y1)
    .lineTo(rect.x2, rect.y2)
    .lineTo(rect.x1, rect.y2)
    .lineTo(rect.x1, rect.y1)
    .stroke({ width: 1, color, pixelLine: true, alignment: 0.5 });
}

/**
 * Build a rubber-band rectangle outline. The gesture builds it once and
 * updates it in place with {@link updateRectMesh} — recreating it every
 * pointermove flickers.
 */
export function buildRectMesh(
  parent: Container,
  rect: Rect,
  color: number = OVERLAY_BLUE,
): Graphics {
  const line = new Graphics({ label: "om-rubber-band" });
  line.eventMode = "none";
  rectColor.set(line, color);
  drawRect(line, rect, color);
  parent.addChild(line);
  requestSceneRender(rootOf(line));
  return line;
}

/** Rewrite the rubber-band's corners in place — clear + redraw on the same
 *  `Graphics`, so the outline tracks the cursor without flicker. */
export function updateRectMesh(mesh: Graphics, rect: Rect): void {
  drawRect(mesh, rect, rectColor.get(mesh) ?? OVERLAY_BLUE);
  requestSceneRender(rootOf(mesh));
}
