import type {
  ConnectionEndpoint,
  ConnectionLayout,
  DiagramLayout,
  Point,
} from "@dicode/omc-client";

import { iconToParent, placementCentre } from "../base/placement-math.js";

/**
 * Reference-tolerant content equality for waypoint arrays. After an OMC
 * roundtrip the layout payload is a fresh object tree so identical
 * paths arrive at the entities with new array identity — without this
 * check, edge / junction meshes would be disposed + rebuilt every
 * commit even when the geometry hasn't actually changed.
 */
export function pointsEqual(a: Point[] | null, b: Point[] | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((p, i) => {
    const q = b[i];
    return q !== undefined && p[0] === q[0] && p[1] === q[1];
  });
}

/** Closest point to `p` on the segment `a`–`b`, clamped to the segment. */
export function projectOntoSegment(
  a: Point,
  b: Point,
  p: { x: number; y: number },
): Point {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) {
    return [a[0], a[1]];
  }
  const t = ((p.x - a[0]) * abx + (p.y - a[1]) * aby) / lenSq;
  const clamped = Math.max(0, Math.min(1, t));
  return [a[0] + clamped * abx, a[1] + clamped * aby];
}

/**
 * Default routing for a freshly-created connection. Returns waypoints
 * (including both endpoints) forming an orthogonal "Z" between `from`
 * and `to`:
 *
 *   - aligned endpoints           → 2-point straight segment
 *   - longer horizontal distance  → split horizontally at the midpoint
 *   - longer vertical distance    → split vertically at the midpoint
 *
 * Tolerance for "aligned" is one diagram unit; coordinates that come
 * out of the picker round to integers via the icon coord system, so
 * anything tighter than that is effectively a coincidence.
 *
 * The route is deliberately simple — no obstacle avoidance, no port-
 * direction awareness. OMEdit ships the same default. Users can edit
 * waypoints after creation; this just gives a sensible start.
 */
export function orthogonalRoute(
  from: { x: number; y: number },
  to: { x: number; y: number },
): Point[] {
  const x1 = from.x;
  const y1 = from.y;
  const x2 = to.x;
  const y2 = to.y;
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const tol = 1;
  if (dx <= tol || dy <= tol) {
    return [
      [x1, y1],
      [x2, y2],
    ];
  }
  if (dx >= dy) {
    const midX = (x1 + x2) / 2;
    return [
      [x1, y1],
      [midX, y1],
      [midX, y2],
      [x2, y2],
    ];
  }
  const midY = (y1 + y2) / 2;
  return [
    [x1, y1],
    [x1, midY],
    [x2, midY],
    [x2, y2],
  ];
}

/**
 * Diagram-space center of a connection endpoint, derived from the layout
 * data alone (no DOM query).
 *
 * For standalone host-class ports (`ep.component === undefined`) the
 * placement is already in diagram coordinates; for sub-component ports the
 * icon-space position is placed the way the renderer places it, signed
 * scale and rotation included, so a mirrored component's port is mirrored.
 *
 * Returns `null` when the endpoint can't be resolved (missing component,
 * missing class, missing port definition).
 */
export function endpointCentreFromLayout(
  layout: DiagramLayout,
  ep: ConnectionEndpoint,
): { x: number; y: number } | null {
  if (ep.component === undefined) {
    const conn = layout.connectors[ep.port];
    if (!conn) return null;
    const [x, y] = placementCentre(conn.placement);
    return { x, y };
  }

  const comp = layout.components[ep.component];
  if (!comp) return null;
  const classDef = layout.classes[comp.classRef];
  if (!classDef) return null;
  const portDef = classDef.connectors[ep.port];
  if (!portDef) return null;

  return iconToParent(
    comp.placement,
    classDef.coordinateSystem,
    placementCentre(portDef.placement),
  );
}

/** Display-only offset for a connection end; `null` leaves it where it is. */
export type EndShift = (
  ep: ConnectionEndpoint,
) => { x: number; y: number } | null;

const NO_SHIFT: EndShift = () => null;

/**
 * Resolves the path to render for a connection.
 *
 * When `conn.waypoints` has two or more points they are the route, with each
 * end moved by `shift`; when it is empty the two endpoint centers are computed
 * from the layout, moved, and an orthogonal route is generated. Returns an
 * empty array only when both endpoints can't be resolved. `conn.waypoints` is
 * never mutated, and comes back by identity when no end moves.
 */
export function resolveConnectionWaypoints(
  layout: DiagramLayout,
  conn: ConnectionLayout,
  shift: EndShift = NO_SHIFT,
): Point[] {
  const lhs = shift(conn.lhs);
  const rhs = shift(conn.rhs);
  if (conn.waypoints.length >= 2) {
    return shiftPathEnds(conn.waypoints, lhs, rhs);
  }
  const from = endpointCentreFromLayout(layout, conn.lhs);
  const to = endpointCentreFromLayout(layout, conn.rhs);
  if (!from || !to) {
    return conn.waypoints;
  }
  return orthogonalRoute(offset(from, lhs), offset(to, rhs));
}

function offset(
  p: { x: number; y: number },
  d: { x: number; y: number } | null,
): { x: number; y: number } {
  return d ? { x: p.x + d.x, y: p.y + d.y } : p;
}

/**
 * Moves the first and last points of `path`. An axis-aligned end segment
 * keeps its axis: the neighbor follows along the perpendicular, so an
 * orthogonal route stays orthogonal.
 */
function shiftPathEnds(
  path: Point[],
  lhs: { x: number; y: number } | null,
  rhs: { x: number; y: number } | null,
): Point[] {
  if (!lhs && !rhs) return path;
  const out = path.map(([x, y]): Point => [x, y]);
  if (lhs) moveEnd(out, 0, 1, lhs);
  if (rhs) moveEnd(out, out.length - 1, out.length - 2, rhs);
  return out;
}

function moveEnd(
  path: Point[],
  end: number,
  next: number,
  d: { x: number; y: number },
): void {
  const p = path[end];
  const q = path[next];
  if (p === undefined || q === undefined) return;
  // A two-point path has no free neighbor: its other end is fixed.
  if (path.length > 2) {
    if (p[1] === q[1]) q[1] += d.y;
    else if (p[0] === q[0]) q[0] += d.x;
  }
  p[0] += d.x;
  p[1] += d.y;
}
