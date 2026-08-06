import type {
  ConnectionLayout,
  DiagramLayout,
  Point,
} from "@dicode/omc-client";

import {
  pointsEqual,
  projectOntoSegment,
  resolveConnectionWaypoints,
} from "./connection-route.js";

/**
 * Edits to a connection's route. Every function takes a `DiagramLayout` and
 * returns a *new* one, or the same reference when the edit is a no-op — so a
 * gesture that lands on the shape it started with commits nothing.
 *
 * Routes stay orthogonal (Manhattan): a dragged segment or waypoint is
 * reconnected to its fixed neighbours through perpendicular jogs, and the
 * coincident / collinear corners that produces are collapsed again, so
 * repeated drags don't accumulate cruft.
 */

type Axis = "h" | "v";

/**
 * Inserts a new waypoint into a connection's route at the point on the
 * polyline closest to `point`. The waypoint lands between the two
 * existing waypoints whose segment owns the projection, so the route's
 * order stays consistent and the new corner sits on the line the user
 * grabbed.
 *
 * Endpoints are never displaced — the insert index is clamped to
 * `[1, length-1]`, i.e. strictly internal. A connection with fewer
 * than two waypoints has no segment to split and is returned unchanged.
 */
export function applyWaypointInsert(
  layout: DiagramLayout,
  connIdx: number,
  point: { x: number; y: number },
): DiagramLayout {
  const conn = layout.connections[connIdx];
  if (!conn || conn.waypoints.length < 2) {
    return layout;
  }
  const insertAt = closestSegmentInsertIndex(conn.waypoints, point);
  const before = conn.waypoints[insertAt - 1];
  const after = conn.waypoints[insertAt];
  if (before === undefined || after === undefined) {
    return layout;
  }
  const proj = projectOntoSegment(before, after, point);
  const waypoints = [
    ...conn.waypoints.slice(0, insertAt),
    proj,
    ...conn.waypoints.slice(insertAt),
  ];
  return replaceConnection(layout, connIdx, { ...conn, waypoints });
}

/**
 * Removes a single internal waypoint from a connection. Endpoint
 * waypoints (index 0 and the last) anchor to their connectors and are
 * never removed; an out-of-range or endpoint index returns the layout
 * unchanged.
 */
export function applyWaypointDelete(
  layout: DiagramLayout,
  connIdx: number,
  waypointIdx: number,
): DiagramLayout {
  const conn = layout.connections[connIdx];
  if (!conn) {
    return layout;
  }
  const lastIdx = conn.waypoints.length - 1;
  if (waypointIdx <= 0 || waypointIdx >= lastIdx) {
    return layout;
  }
  const waypoints = conn.waypoints.filter((_, i) => i !== waypointIdx);
  return replaceConnection(layout, connIdx, { ...conn, waypoints });
}

/**
 * Drags the connection segment nearest `grab` to follow the pointer,
 * keeping the route orthogonal: a horizontal segment moves only
 * vertically, a vertical one only horizontally — the parallel-axis delta
 * is ignored. When the grabbed segment touches an anchored endpoint
 * (`waypoints[0]` or the last waypoint), a perpendicular jog waypoint is
 * inserted so the endpoint stays pinned to its connector.
 *
 * Returns the same layout reference when there's nothing to move (zero
 * delta, an unknown connection, fewer than two waypoints, or a result
 * identical to the input) so `commitLayout` can skip the change event.
 */
export function applyEdgeSegmentDrag(
  layout: DiagramLayout,
  connIdx: number,
  grab: { x: number; y: number },
  dx: number,
  dy: number,
): DiagramLayout {
  if (dx === 0 && dy === 0) {
    return layout;
  }
  const conn = layout.connections[connIdx];
  if (!conn || conn.waypoints.length < 2) {
    return layout;
  }
  const wps = conn.waypoints;
  const seg = closestSegmentIndex(wps, grab);
  const a = wps[seg];
  const b = wps[seg + 1];
  if (a === undefined || b === undefined) {
    return layout;
  }
  // Coincident endpoints have no defined axis; no drag is possible.
  if (a[0] === b[0] && a[1] === b[1]) {
    return layout;
  }
  const lastIdx = wps.length - 1;
  const horizontal = segmentAxis(a, b) === "h";

  let p: Point;
  let q: Point;
  if (horizontal) {
    const y = a[1] + dy;
    p = [a[0], y];
    q = [b[0], y];
  } else {
    const x = a[0] + dx;
    p = [x, a[1]];
    q = [x, b[1]];
  }

  // The grabbed endpoints become `p`/`q`. Each seam to a neighbour is
  // reconnected through an orthogonal jog (a coincident / collinear one
  // is collapsed by `simplifyOrthogonalPath`, so an already-aligned
  // neighbour costs nothing). At a terminal segment the neighbour is the
  // anchor itself, which the perpendicular move already meets squarely.
  let left: Point[];
  if (seg === 0) {
    left = [[a[0], a[1]]];
  } else {
    const prevNb = wps[seg - 1];
    if (prevNb === undefined) {
      return layout;
    }
    left = [
      ...wps.slice(0, seg),
      jogFromStart(prevNb, p, segmentAxis(prevNb, a)),
    ];
  }
  let right: Point[];
  if (seg + 1 === lastIdx) {
    right = [[b[0], b[1]]];
  } else {
    const nextNb = wps[seg + 2];
    if (nextNb === undefined) {
      return layout;
    }
    right = [
      jogToEnd(q, nextNb, segmentAxis(b, nextNb)),
      ...wps.slice(seg + 2),
    ];
  }

  const waypoints = simplifyOrthogonalPath([...left, p, q, ...right]);
  return storeRoute(layout, connIdx, conn, waypoints);
}

/**
 * Drags a single internal waypoint, keeping the route orthogonal: each
 * adjacent segment is reconnected to its fixed neighbour through a
 * perpendicular jog (inserted only when the neighbour doesn't already
 * line up). Endpoint waypoints anchor to their connectors and aren't
 * draggable.
 *
 * Returns the same layout reference when there's nothing to move (zero
 * delta, an unknown connection, an endpoint / out-of-range index, or a
 * result identical to the input).
 */
export function applyWaypointDrag(
  layout: DiagramLayout,
  connIdx: number,
  waypointIdx: number,
  dx: number,
  dy: number,
): DiagramLayout {
  if (dx === 0 && dy === 0) {
    return layout;
  }
  const conn = layout.connections[connIdx];
  if (!conn) {
    return layout;
  }
  const waypoints = reshapeAroundWaypoint(conn.waypoints, waypointIdx, dx, dy);
  if (waypoints === null) {
    return layout;
  }
  return storeRoute(layout, connIdx, conn, waypoints);
}

/**
 * The route `waypoints` becomes when the waypoint at `idx` moves by
 * (dx, dy) and both adjacent segments are re-squared through jogs, or
 * `null` for an endpoint / out-of-range index — those anchor to a
 * connector and don't move on their own.
 */
export function reshapeAroundWaypoint(
  waypoints: ReadonlyArray<Point>,
  idx: number,
  dx: number,
  dy: number,
): Point[] | null {
  const lastIdx = waypoints.length - 1;
  if (idx <= 0 || idx >= lastIdx) return null;
  const prev = waypoints[idx - 1];
  const curr = waypoints[idx];
  const next = waypoints[idx + 1];
  if (prev === undefined || curr === undefined || next === undefined) {
    return null;
  }
  const moved: Point = [curr[0] + dx, curr[1] + dy];
  const inJog = jogFromStart(prev, moved, segmentAxis(prev, curr));
  const outJog = jogToEnd(moved, next, segmentAxis(curr, next));
  return simplifyOrthogonalPath([
    ...waypoints.slice(0, idx - 1),
    prev,
    inJog,
    moved,
    outJog,
    next,
    ...waypoints.slice(idx + 2),
  ]);
}

/**
 * A layout where the connection at `connIdx` carries a route derived from
 * its endpoint positions when it currently has none (`waypoints: []`).
 * A waypoint gesture needs a route to reshape; the renderer auto-routes an
 * empty one, so without this the first drag would have nothing to grab.
 * Returns the same reference when the connection already has a route or
 * its endpoints can't be resolved.
 */
export function withMaterialisedRoute(
  layout: DiagramLayout,
  connIdx: number,
): DiagramLayout {
  const conn = layout.connections[connIdx];
  if (!conn || conn.waypoints.length > 0) {
    return layout;
  }
  const waypoints = resolveConnectionWaypoints(layout, conn);
  if (waypoints.length < 2) {
    return layout;
  }
  const connections = layout.connections.map((c, i) =>
    i === connIdx ? { ...c, waypoints } : c,
  );
  return { ...layout, connections };
}

/** Stores `waypoints` on `connIdx`, or returns the original `layout`
 *  reference when they match the connection's current route. */
function storeRoute(
  layout: DiagramLayout,
  connIdx: number,
  conn: ConnectionLayout,
  waypoints: Point[],
): DiagramLayout {
  if (pointsEqual(waypoints, conn.waypoints)) {
    return layout;
  }
  return replaceConnection(layout, connIdx, { ...conn, waypoints });
}

/** Dominant orientation of segment `a`–`b`: horizontal when its x-run is
 *  at least its y-run, vertical otherwise. */
function segmentAxis(a: Point, b: Point): Axis {
  return Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? "h" : "v";
}

/** Corner that lets the segment leaving `from` run along `axis` before
 *  turning perpendicular to reach `to`. */
function jogFromStart(from: Point, to: Point, axis: Axis): Point {
  return axis === "h" ? [to[0], from[1]] : [from[0], to[1]];
}

/** Corner that lets the segment arriving at `to` run along `axis`, having
 *  turned from `from`. */
function jogToEnd(from: Point, to: Point, axis: Axis): Point {
  return axis === "h" ? [from[0], to[1]] : [to[0], from[1]];
}

/** Index of the segment (`waypoints[i]`–`waypoints[i+1]`) whose nearest
 *  point to `point` is closest. Always in `[0, length-2]`. */
function closestSegmentIndex(
  waypoints: ReadonlyArray<Point>,
  point: { x: number; y: number },
): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    if (a === undefined || b === undefined) {
      continue;
    }
    const dist = distanceToSegment(a, b, point);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/**
 * Index `i` such that the new waypoint belongs between `waypoints[i-1]`
 * and `waypoints[i]` — the segment whose projection of `point` is
 * nearest. Always in `[1, length-1]`, so endpoints aren't displaced.
 */
function closestSegmentInsertIndex(
  waypoints: ReadonlyArray<Point>,
  point: { x: number; y: number },
): number {
  let best = 1;
  let bestDist = Infinity;
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1];
    const b = waypoints[i];
    if (a === undefined || b === undefined) {
      continue;
    }
    const dist = distanceToSegment(a, b, point);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/** Squared distance from `p` to the segment `a`–`b`. Squared because only
 *  the ordering matters to the callers. */
function distanceToSegment(
  a: Point,
  b: Point,
  p: { x: number; y: number },
): number {
  const proj = projectOntoSegment(a, b, p);
  const dx = proj[0] - p.x;
  const dy = proj[1] - p.y;
  return dx * dx + dy * dy;
}

/**
 * Collapse a waypoint list: drop coincident points, then drop any
 * middle point collinear (sharing an x or a y) with its neighbours. The
 * first and last waypoints — the connector anchors — are always kept.
 */
function simplifyOrthogonalPath(points: Point[]): Point[] {
  const dedup: Point[] = [];
  for (const p of points) {
    const prev = dedup.at(-1);
    if (prev && prev[0] === p[0] && prev[1] === p[1]) {
      continue;
    }
    dedup.push(p);
  }
  if (dedup.length <= 2) {
    return dedup;
  }
  const first = dedup[0];
  const last = dedup.at(-1);
  if (first === undefined || last === undefined) {
    return dedup;
  }
  const out: Point[] = [first];
  for (let i = 1; i < dedup.length - 1; i++) {
    const b = dedup[i];
    const c = dedup[i + 1];
    const a = out.at(-1);
    if (a === undefined || b === undefined || c === undefined) {
      continue;
    }
    const collinearX = a[0] === b[0] && b[0] === c[0];
    const collinearY = a[1] === b[1] && b[1] === c[1];
    if (collinearX || collinearY) {
      continue;
    }
    out.push(b);
  }
  out.push(last);
  return out;
}

function replaceConnection(
  layout: DiagramLayout,
  connIdx: number,
  conn: ConnectionLayout,
): DiagramLayout {
  const connections = layout.connections.map((c, i) =>
    i === connIdx ? conn : c,
  );
  return { ...layout, connections };
}
