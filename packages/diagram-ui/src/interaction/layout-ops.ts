import type {
  DiagramLayout,
  Extent,
  Placement,
  Point,
} from "@dicode/omc-client";

import { parseKey, type EntityKind } from "./node-keys.js";
import { orthogonalRoute } from "./connection-route.js";
import { snapPlacement, type SnapGrid } from "./snap-math.js";

/**
 * Pure layout mutations. Each function takes a `DiagramLayout` and
 * returns a *new* `DiagramLayout` — the caller is responsible for
 * propagating the result. Mirrors dyad-ui's `layout-ops.ts` pattern
 * but operates on the omc-client `DiagramLayout` shape.
 *
 * The mutations are intentionally permissive: unknown keys are
 * ignored, never throw. Higher layers (host element, undo stack)
 * decide what to do with stale references.
 */

interface JunctionRef {
  connIdx: number;
  waypointIdx: number;
}

interface KeySet {
  components: Set<string>;
  connectors: Set<string>;
  /** Whole-connection ops (edge selection / deletion). */
  connections: Set<number>;
  /** Per-waypoint refs from junction keys (`junc:<conn>/<wp>`). */
  junctions: JunctionRef[];
}

function partitionKeys(keys: Iterable<string>): KeySet {
  const out: KeySet = {
    components: new Set(),
    connectors: new Set(),
    connections: new Set(),
    junctions: [],
  };
  for (const k of keys) {
    const parsed = parseKey(k);
    if (!parsed) {
      continue;
    }
    routeKey(out, parsed.kind, parsed.nodeId);
  }
  return out;
}

function routeKey(out: KeySet, kind: EntityKind, id: string): void {
  switch (kind) {
    case "component":
      out.components.add(id);
      break;
    case "connector":
      out.connectors.add(id);
      break;
    case "edge": {
      // Whole-connection key — `id` is the connection index.
      const idx = Number(id);
      if (!Number.isNaN(idx)) {
        out.connections.add(idx);
      }
      break;
    }
    case "junction": {
      // Compound key `<conn>/<waypointIdx>`.
      const slash = id.indexOf("/");
      if (slash < 0) {
        return;
      }
      const connIdx = Number(id.slice(0, slash));
      const waypointIdx = Number(id.slice(slash + 1));
      if (!Number.isNaN(connIdx) && !Number.isNaN(waypointIdx)) {
        out.junctions.push({ connIdx, waypointIdx });
      }
      break;
    }
    default:
      break;
  }
}

function shiftExtent(extent: Extent, dx: number, dy: number): Extent {
  return [
    [extent[0][0] + dx, extent[0][1] + dy],
    [extent[1][0] + dx, extent[1][1] + dy],
  ];
}

function shiftPlacement(p: Placement, dx: number, dy: number): Placement {
  return { ...p, extent: shiftExtent(p.extent, dx, dy) };
}

/** Translates every entity in `keys` by (dx, dy) diagram units. */
export function applyDeltaMove(
  layout: DiagramLayout,
  keys: Iterable<string>,
  dx: number,
  dy: number,
): DiagramLayout {
  if (dx === 0 && dy === 0) {
    return layout;
  }
  const set = partitionKeys(keys);
  let mutated = false;
  const components = { ...layout.components };
  for (const id of set.components) {
    const c = components[id];
    if (!c) {
      continue;
    }
    components[id] = { ...c, placement: shiftPlacement(c.placement, dx, dy) };
    mutated = true;
  }
  const connectors = { ...layout.connectors };
  for (const id of set.connectors) {
    const c = connectors[id];
    if (!c) {
      continue;
    }
    connectors[id] = { ...c, placement: shiftPlacement(c.placement, dx, dy) };
    mutated = true;
  }
  // Connections get touched for two reasons:
  //   - a junction key in `set.junctions` shifts a specific internal
  //     waypoint, OR
  //   - the connection's lhs / rhs endpoint sits on a component or
  //     standalone connector that's in `set.components` /
  //     `set.connectors` — in which case waypoints[0] (lhs) and / or
  //     waypoints[last] (rhs) follow the entity by the same dx/dy.
  // We make one pass so a connection that needs both stays consistent.
  let connections = layout.connections;
  const junctionsByConn = new Map<number, Set<number>>();
  for (const { connIdx, waypointIdx } of set.junctions) {
    let wps = junctionsByConn.get(connIdx);
    if (!wps) {
      wps = new Set();
      junctionsByConn.set(connIdx, wps);
    }
    wps.add(waypointIdx);
  }
  if (
    junctionsByConn.size > 0 ||
    set.components.size > 0 ||
    set.connectors.size > 0
  ) {
    let connsMutated = false;
    connections = layout.connections.map((conn, idx) => {
      const wpIdxs = junctionsByConn.get(idx);
      const lhsMoves =
        (conn.lhs.component !== undefined &&
          set.components.has(conn.lhs.component)) ||
        (conn.lhs.component === undefined && set.connectors.has(conn.lhs.port));
      const rhsMoves =
        (conn.rhs.component !== undefined &&
          set.components.has(conn.rhs.component)) ||
        (conn.rhs.component === undefined && set.connectors.has(conn.rhs.port));
      if (!wpIdxs && !lhsMoves && !rhsMoves) {
        return conn;
      }
      if (conn.waypoints.length === 0) {
        // No persisted route; the renderer will auto-route from the
        // (now-moved) connector positions on next draw. Nothing for
        // us to shift.
        return conn;
      }
      const lastIdx = conn.waypoints.length - 1;
      // Both endpoints moving together → translate the whole route
      // verbatim. The shape is preserved, including any user-placed
      // junctions, and orthogonal segments stay orthogonal because
      // every waypoint shifts by the same (dx, dy).
      if (lhsMoves && rhsMoves) {
        const waypoints = conn.waypoints.map(
          ([x, y]) => [x + dx, y + dy] as Point,
        );
        connsMutated = true;
        return { ...conn, waypoints };
      }
      // Only one endpoint moves → re-route orthogonally between the
      // new endpoint and the unchanged one. Without this, the first /
      // last segment would tilt and the connection would lose its
      // right angles — visible as a diagonal "kink" between two
      // otherwise-orthogonal segments. Re-routing discards any
      // user-placed junctions on this connection; that's an accepted
      // trade-off for keeping the visual contract during component
      // drags. (Junction-only drags fall through to the per-waypoint
      // path below and preserve the shape.)
      if (lhsMoves !== rhsMoves) {
        const fromWp = conn.waypoints[0]!;
        const toWp = conn.waypoints[lastIdx]!;
        const from = lhsMoves
          ? { x: fromWp[0] + dx, y: fromWp[1] + dy }
          : { x: fromWp[0], y: fromWp[1] };
        const to = rhsMoves
          ? { x: toWp[0] + dx, y: toWp[1] + dy }
          : { x: toWp[0], y: toWp[1] };
        connsMutated = true;
        return { ...conn, waypoints: orthogonalRoute(from, to) };
      }
      // Junction-only drag: move the grabbed waypoint(s) and slide
      // adjacent internal waypoints so each segment stays axis-
      // aligned. Endpoint-adjacent segments constrain the drag along
      // the axis they fix (e.g. dragging the first elbow of a Z whose
      // first segment is horizontal won't move along y — the source
      // connector is anchored).
      const waypoints = applyJunctionDeltaOrthogonal(
        conn.waypoints,
        wpIdxs ?? new Set(),
        dx,
        dy,
      );
      connsMutated = true;
      return { ...conn, waypoints };
    });
    if (connsMutated) {
      mutated = true;
    }
  }

  if (!mutated) {
    return layout;
  }
  return { ...layout, components, connectors, connections };
}

const ORTHO_EPS = 1e-6;

/**
 * Apply a (dx, dy) drag to the specified internal waypoints of a
 * connection while keeping every segment axis-aligned.
 *
 * Each moved junction sits at the corner of two segments. Whichever
 * axis a segment fixed before the drag must keep that same axis
 * fixed after — that means the non-moved endpoint of the segment
 * has to track the moved waypoint along the matching axis.
 *
 * Endpoints (waypoint 0 and waypoint N-1) are anchored to their
 * connectors. If an endpoint-adjacent segment was H, dragging the
 * junction along y would tilt that segment; we clamp `dy` instead.
 * Same for V segments and `dx`. This makes some directions feel
 * "locked" when the route is short, but it preserves orthogonality
 * without inserting new corners behind the user's back.
 *
 * Multi-junction drags fall back to a plain per-waypoint shift —
 * applying the orthogonal logic per junction would fight against
 * adjacent moved junctions on the same connection. Multi-select on
 * one connection's junctions is rare enough that we accept the
 * lower-fidelity behaviour.
 */
function applyJunctionDeltaOrthogonal(
  waypoints: ReadonlyArray<Point>,
  movingIdxs: ReadonlySet<number>,
  dx: number,
  dy: number,
): Point[] {
  const out: [number, number][] = waypoints.map(([x, y]) => [x, y]);
  const lastIdx = waypoints.length - 1;
  if (movingIdxs.size !== 1) {
    for (const i of movingIdxs) {
      const wp = out[i];
      if (!wp) continue;
      out[i] = [wp[0] + dx, wp[1] + dy];
    }
    return out.map(([x, y]) => [x, y] as Point);
  }
  const i = movingIdxs.values().next().value as number;
  if (i <= 0 || i >= lastIdx) {
    // Endpoint waypoint or stray index — fall back to shift.
    const wp = out[i];
    if (wp) out[i] = [wp[0] + dx, wp[1] + dy];
    return out.map(([x, y]) => [x, y] as Point);
  }
  const prev = waypoints[i - 1]!;
  const cur = waypoints[i]!;
  const next = waypoints[i + 1]!;
  const segPrevH = Math.abs(prev[1] - cur[1]) < ORTHO_EPS;
  const segPrevV = Math.abs(prev[0] - cur[0]) < ORTHO_EPS;
  const segNextH = Math.abs(next[1] - cur[1]) < ORTHO_EPS;
  const segNextV = Math.abs(next[0] - cur[0]) < ORTHO_EPS;
  const prevIsEndpoint = i - 1 === 0;
  const nextIsEndpoint = i + 1 === lastIdx;
  // Endpoint-adjacent segments clamp the axis they fix.
  let effDx = dx;
  let effDy = dy;
  if (prevIsEndpoint && segPrevH) effDy = 0;
  if (prevIsEndpoint && segPrevV) effDx = 0;
  if (nextIsEndpoint && segNextH) effDy = 0;
  if (nextIsEndpoint && segNextV) effDx = 0;
  out[i] = [cur[0] + effDx, cur[1] + effDy];
  if (!prevIsEndpoint) {
    if (segPrevH) out[i - 1] = [prev[0], prev[1] + effDy];
    else if (segPrevV) out[i - 1] = [prev[0] + effDx, prev[1]];
  }
  if (!nextIsEndpoint) {
    if (segNextH) out[i + 1] = [next[0], next[1] + effDy];
    else if (segNextV) out[i + 1] = [next[0] + effDx, next[1]];
  }
  return out.map(([x, y]) => [x, y] as Point);
}

/**
 * Snap every moved entity's placement to the active grid. Runs once
 * on drag-commit so the final extent corners land on grid
 * intersections regardless of where the component started — fixes
 * the "off-grid component stays off-grid" failure mode where
 * `snapDelta` only rounded the delta, preserving any pre-existing
 * sub-grid offset.
 *
 * Only walks the keys the caller actually moved (components +
 * connectors). Junction waypoints aren't snapped here: with no
 * persisted route, they're auto-re-routed from the (already-snapped)
 * connector positions on next paint; with a persisted route, the
 * user explicitly placed them and a follow-up snap pass for
 * waypoints lives next to that gesture.
 *
 * Returns the same reference when nothing changed (e.g. grid `[0,0]`
 * or every placement was already aligned) so Lit's change tracking
 * stays cheap.
 */
export function applySnapToExtents(
  layout: DiagramLayout,
  keys: Iterable<string>,
  grid: SnapGrid,
): DiagramLayout {
  if (grid[0] <= 0 && grid[1] <= 0) {
    return layout;
  }
  const set = partitionKeys(keys);
  let mutated = false;
  const components = { ...layout.components };
  for (const id of set.components) {
    const c = components[id];
    if (!c) continue;
    const snapped = snapPlacement(c.placement, grid);
    if (snapped !== c.placement) {
      components[id] = { ...c, placement: snapped };
      mutated = true;
    }
  }
  const connectors = { ...layout.connectors };
  for (const id of set.connectors) {
    const c = connectors[id];
    if (!c) continue;
    const snapped = snapPlacement(c.placement, grid);
    if (snapped !== c.placement) {
      connectors[id] = { ...c, placement: snapped };
      mutated = true;
    }
  }
  if (!mutated) {
    return layout;
  }
  return { ...layout, components, connectors };
}

/** Sets the absolute placement extent of a single component. */
export function applyComponentExtent(
  layout: DiagramLayout,
  id: string,
  extent: Extent,
): DiagramLayout {
  const c = layout.components[id];
  if (!c) {
    return layout;
  }
  return {
    ...layout,
    components: {
      ...layout.components,
      [id]: { ...c, placement: { ...c.placement, extent } },
    },
  };
}

/** Same as applyComponentExtent but for standalone connectors. */
export function applyConnectorExtent(
  layout: DiagramLayout,
  id: string,
  extent: Extent,
): DiagramLayout {
  const c = layout.connectors[id];
  if (!c) {
    return layout;
  }
  return {
    ...layout,
    connectors: {
      ...layout.connectors,
      [id]: { ...c, placement: { ...c.placement, extent } },
    },
  };
}

/** Deletes the entities under `keys` from the layout. */
export function applyDelete(
  layout: DiagramLayout,
  keys: Iterable<string>,
): DiagramLayout {
  const set = partitionKeys(keys);
  if (
    set.components.size === 0 &&
    set.connectors.size === 0 &&
    set.connections.size === 0
  ) {
    return layout;
  }
  const components = { ...layout.components };
  for (const id of set.components) {
    delete components[id];
  }
  const connectors = { ...layout.connectors };
  for (const id of set.connectors) {
    delete connectors[id];
  }
  const connections = layout.connections.filter(
    (_, idx) => !set.connections.has(idx),
  );
  return { ...layout, components, connectors, connections };
}

/**
 * Rotates each selected component / connector around its placement
 * centre by ±90°. Modelica rotation is in degrees CCW positive, so
 * `cw` subtracts 90.
 */
export function applyRotate(
  layout: DiagramLayout,
  keys: Iterable<string>,
  cw: boolean,
): DiagramLayout {
  const delta = cw ? -90 : 90;
  return forEachShape(layout, keys, (p) => ({
    ...p,
    rotation: ((p.rotation ?? 0) + delta + 360) % 360,
  }));
}

/**
 * Mirrors each selected entity horizontally (`horizontal=true`) or
 * vertically by negating one axis of the placement extent.
 */
export function applyFlip(
  layout: DiagramLayout,
  keys: Iterable<string>,
  horizontal: boolean,
): DiagramLayout {
  return forEachShape(layout, keys, (p) => {
    const [[x1, y1], [x2, y2]] = p.extent;
    const ext: Extent = horizontal
      ? [
          [x2, y1],
          [x1, y2],
        ]
      : [
          [x1, y2],
          [x2, y1],
        ];
    return { ...p, extent: ext };
  });
}

function forEachShape(
  layout: DiagramLayout,
  keys: Iterable<string>,
  mut: (p: Placement) => Placement,
): DiagramLayout {
  const set = partitionKeys(keys);
  let mutated = false;
  const components = { ...layout.components };
  for (const id of set.components) {
    const c = components[id];
    if (!c) {
      continue;
    }
    components[id] = { ...c, placement: mut(c.placement) };
    mutated = true;
  }
  const connectors = { ...layout.connectors };
  for (const id of set.connectors) {
    const c = connectors[id];
    if (!c) {
      continue;
    }
    connectors[id] = { ...c, placement: mut(c.placement) };
    mutated = true;
  }
  return mutated ? { ...layout, components, connectors } : layout;
}

/** A diagram-coord-space rectangle used by rubber-band selection. */
export interface DiagramRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Normalises so x1<=x2 and y1<=y2. */
export function normaliseRect(r: DiagramRect): DiagramRect {
  return {
    x1: Math.min(r.x1, r.x2),
    x2: Math.max(r.x1, r.x2),
    y1: Math.min(r.y1, r.y2),
    y2: Math.max(r.y1, r.y2),
  };
}

function placementCentre(p: Placement): Point {
  const [[x1, y1], [x2, y2]] = p.extent;
  const ox = p.origin?.[0] ?? 0;
  const oy = p.origin?.[1] ?? 0;
  return [ox + (x1 + x2) / 2, oy + (y1 + y2) / 2];
}

function rectContains(r: DiagramRect, x: number, y: number): boolean {
  return x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;
}

/**
 * Returns the keys of every component / connector whose placement
 * centre falls inside `rect`. Connections aren't selected by rubber-
 * band — their waypoints would force extra geometry awareness; the
 * host element can add that in F1 if it ends up needed.
 */
export function selectByDiagramRect(
  layout: DiagramLayout,
  rect: DiagramRect,
): Set<string> {
  const r = normaliseRect(rect);
  const keys = new Set<string>();
  for (const [id, c] of Object.entries(layout.components)) {
    const [cx, cy] = placementCentre(c.placement);
    if (rectContains(r, cx, cy)) {
      keys.add(`c:${id}`);
    }
  }
  for (const [id, c] of Object.entries(layout.connectors)) {
    const [cx, cy] = placementCentre(c.placement);
    if (rectContains(r, cx, cy)) {
      keys.add(`k:${id}`);
    }
  }
  return keys;
}
