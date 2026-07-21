import type {
  Color,
  ConnectionEndpoint,
  ConnectionLayout,
  DiagramLayout,
  Extent,
  IconLayer,
  Placement,
  Point,
  Shape,
} from "@dicode/omc-client";

import { parseKey, type EntityKind } from "./node-keys.js";
import { orthogonalRoute, pointsEqual } from "./connection-route.js";
import {
  snapExtent,
  snapPlacement,
  snapPoint,
  type SnapGrid,
} from "./snap-math.js";
import { POLY_MIN_VERTICES, type ExtentKind, type PolyKind } from "./tools.js";

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
  /** Own-layer shape indices from `shape:<kind>:<index>` keys. */
  shapes: Set<number>;
}

function partitionKeys(keys: Iterable<string>): KeySet {
  const out: KeySet = {
    components: new Set(),
    connectors: new Set(),
    connections: new Set(),
    junctions: [],
    shapes: new Set(),
  };
  for (const k of keys) {
    const parsed = parseKey(k);
    if (!parsed) {
      continue;
    }
    if (parsed.kind === "shape") {
      if (Number.isInteger(parsed.index)) {
        out.shapes.add(parsed.index);
      }
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

/**
 * Drags one visual extent corner to (x, y) in the parent's diagram coords,
 * holding the opposite corner fixed. The grabbed corner is named by what the
 * user sees — `tr` = the right (max-x) + top (max-y) edges — and maps to
 * whichever extent slots currently hold those edges, so it works no matter
 * how the corners were authored (host-shape annotations can store the top
 * corner first; component placements store the min corner first). Dragging
 * past the anchor leaves the output extent inverted on that axis — a
 * Modelica mirror. Callers pass the original (gesture-start) extent on every
 * move, so the slot mapping stays fixed for the whole drag. Shared by
 * component/connector placements and host shapes.
 */
function dragCorner(
  extent: Extent,
  origin: Point | undefined,
  corner: "tl" | "tr" | "bl" | "br",
  x: number,
  y: number,
): Extent {
  const ox = origin?.[0] ?? 0;
  const oy = origin?.[1] ?? 0;
  const out: Extent = [
    [extent[0][0], extent[0][1]],
    [extent[1][0], extent[1][1]],
  ];
  const xMaxAt0 = extent[0][0] >= extent[1][0];
  const yMaxAt0 = extent[0][1] >= extent[1][1];
  const wantMaxX = corner[1] === "r";
  const wantMaxY = corner[0] === "t";
  out[wantMaxX === xMaxAt0 ? 0 : 1][0] = x - ox;
  out[wantMaxY === yMaxAt0 ? 0 : 1][1] = y - oy;
  return out;
}

// ── Host-shape ops ───────────────────────────────────────────────────
//
// Drawn primitives live positionally in the host class's OWN layer
// (`from === className`) of the current view (`icon` vs `diagram`).
// A `shape:<kind>:<index>` key addresses one by its index there. Unlike
// components/connectors, no connection terminates on a host shape, so
// these ops never re-anchor.

/** Line / Polygon carry `points`; the other primitives carry an `extent`. */
function isPolyShape(
  s: Shape,
): s is Extract<Shape, { kind: "line" | "polygon" }> {
  return s.kind === "line" || s.kind === "polygon";
}

/** The host's own editable layer, or `null` when it has no own graphics. */
function ownLayer(layout: DiagramLayout): {
  field: "iconLayers" | "diagramLayers";
  index: number;
  shapes: Shape[];
} | null {
  const field = layout.kind === "icon" ? "iconLayers" : "diagramLayers";
  const layers = layout[field];
  const index = layers.findIndex((l) => l.from === layout.className);
  const own = index < 0 ? undefined : layers[index];
  return own ? { field, index, shapes: own.shapes } : null;
}

function replaceOwnShapes(
  layout: DiagramLayout,
  field: "iconLayers" | "diagramLayers",
  layerIndex: number,
  shapes: Shape[],
): DiagramLayout {
  const layers = layout[field].map((l, i) =>
    i === layerIndex ? { ...l, shapes } : l,
  );
  return { ...layout, [field]: layers };
}

/**
 * Replaces each own-layer shape in `indices` via `fn`. A `fn` returning
 * `null` (or the same reference) leaves that shape untouched; the whole
 * call returns the same `layout` reference when nothing changed.
 */
function updateOwnShapes(
  layout: DiagramLayout,
  indices: ReadonlySet<number>,
  fn: (shape: Shape) => Shape | null,
): DiagramLayout {
  if (indices.size === 0) {
    return layout;
  }
  const own = ownLayer(layout);
  if (!own) {
    return layout;
  }
  let mutated = false;
  const shapes = own.shapes.map((s, i) => {
    if (!indices.has(i)) {
      return s;
    }
    const next = fn(s);
    if (next && next !== s) {
      mutated = true;
      return next;
    }
    return s;
  });
  return mutated
    ? replaceOwnShapes(layout, own.field, own.index, shapes)
    : layout;
}

/** Translates a shape by (dx, dy): poly shapes move every vertex; extent
 *  shapes move their extent, or — when rotated — their `origin`, since the
 *  extent lives inside the shape's rotation and shifting it there would
 *  translate along the rotated axes. */
function moveShape(s: Shape, dx: number, dy: number): Shape {
  if (isPolyShape(s)) {
    return {
      ...s,
      points: s.points.map(([x, y]) => [x + dx, y + dy] as Point),
    };
  }
  if (s.rotation) {
    const ox = s.origin?.[0] ?? 0;
    const oy = s.origin?.[1] ?? 0;
    return { ...s, origin: [ox + dx, oy + dy] };
  }
  return { ...s, extent: shiftExtent(s.extent, dx, dy) };
}

/** Drags one extent corner of an extent shape, holding the opposite corner
 *  fixed. Poly shapes have no extent and return `null` (resize is
 *  extent-only; vertex editing is its own gesture). */
function resizeShapeExtent(
  s: Shape,
  corner: "tl" | "tr" | "bl" | "br",
  x: number,
  y: number,
): Shape | null {
  if (isPolyShape(s)) {
    return null;
  }
  return { ...s, extent: dragCorner(s.extent, s.origin, corner, x, y) };
}

/**
 * Re-expresses an extent shape so its `origin` sits at the shape's visual
 * centre, with `extent` recentred about it — appearance unchanged. A
 * Modelica shape rotates about its `origin`, so this makes the rotation
 * pivot the centre the user expects (otherwise a shape with `origin={0,0}`
 * swings around the diagram origin).
 */
function centreOrigin(s: Extract<Shape, { extent: Extent }>): typeof s {
  const cx = (s.extent[0][0] + s.extent[1][0]) / 2;
  const cy = (s.extent[0][1] + s.extent[1][1]) / 2;
  const ox = s.origin?.[0] ?? 0;
  const oy = s.origin?.[1] ?? 0;
  return {
    ...s,
    origin: [ox + cx, oy + cy],
    extent: [
      [s.extent[0][0] - cx, s.extent[0][1] - cy],
      [s.extent[1][0] - cx, s.extent[1][1] - cy],
    ],
  };
}

/** Sets a shape's absolute rotation, pivoting about its visual centre;
 *  `null` when already at `norm`. */
function rotateShape(s: Shape, norm: number): Shape | null {
  if ((s.rotation ?? 0) === norm) {
    return null;
  }
  if (isPolyShape(s)) {
    return { ...s, rotation: norm };
  }
  return { ...centreOrigin(s), rotation: norm };
}

/** Visual centre of a shape (origin + geometry centre) — the pivot for
 *  drag-to-rotate, matching the point the renderer rotates about. */
function shapeCentreOf(s: Shape): Point {
  const ox = s.origin?.[0] ?? 0;
  const oy = s.origin?.[1] ?? 0;
  if (isPolyShape(s)) {
    if (s.points.length === 0) {
      return [ox, oy];
    }
    const xs = s.points.map((p) => p[0]);
    const ys = s.points.map((p) => p[1]);
    return [
      ox + (Math.min(...xs) + Math.max(...xs)) / 2,
      oy + (Math.min(...ys) + Math.max(...ys)) / 2,
    ];
  }
  return [
    ox + (s.extent[0][0] + s.extent[1][0]) / 2,
    oy + (s.extent[0][1] + s.extent[1][1]) / 2,
  ];
}

/** Snaps a shape's geometry to the grid; same reference when unchanged. */
function snapShape(s: Shape, grid: SnapGrid): Shape {
  if (isPolyShape(s)) {
    let changed = false;
    const points = s.points.map(([x, y]) => {
      const { x: sx, y: sy } = snapPoint(x, y, grid);
      if (sx !== x || sy !== y) {
        changed = true;
      }
      return [sx, sy] as Point;
    });
    return changed ? { ...s, points } : s;
  }
  const snapped = snapExtent(s.extent, grid);
  return snapped === s.extent ? s : { ...s, extent: snapped };
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
      if (wpIdxs && wpIdxs.size === 1) {
        const [idx] = wpIdxs;
        if (idx === undefined) return conn;
        const candidate = waypointsWithJog(conn.waypoints, idx, dx, dy);
        if (candidate !== null) {
          const waypoints = simplifyOrthogonalPath(candidate);
          if (!pointsEqual(waypoints, conn.waypoints)) {
            connsMutated = true;
            return { ...conn, waypoints };
          }
          return conn;
        }
      }
      if (wpIdxs === undefined) return conn;
      const waypoints = shiftWaypoints(conn.waypoints, wpIdxs, dx, dy);
      connsMutated = true;
      return { ...conn, waypoints };
    });
    if (connsMutated) {
      mutated = true;
    }
  }

  const base = mutated
    ? { ...layout, components, connectors, connections }
    : layout;
  return updateOwnShapes(base, set.shapes, (s) => moveShape(s, dx, dy));
}

/** Per-waypoint shift for multi-junction drags on one connection.
 *  Jog-insertion would fight adjacent moved junctions, so these drags
 *  use a plain translate instead. */
function shiftWaypoints(
  waypoints: ReadonlyArray<Point>,
  movingIdxs: ReadonlySet<number>,
  dx: number,
  dy: number,
): Point[] {
  const out: Point[] = waypoints.map(([x, y]) => [x, y]);
  for (const i of movingIdxs) {
    const wp = out[i];
    if (wp === undefined) continue;
    out[i] = [wp[0] + dx, wp[1] + dy];
  }
  return out;
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
  const componentXf = new Map<string, PointXf>();
  const connectorXf = new Map<string, PointXf>();
  const components = { ...layout.components };
  for (const id of set.components) {
    const c = components[id];
    if (!c) continue;
    const snapped = snapPlacement(c.placement, grid);
    if (snapped !== c.placement) {
      componentXf.set(id, snapTransform(c.placement, snapped));
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
      connectorXf.set(id, snapTransform(c.placement, snapped));
      connectors[id] = { ...c, placement: snapped };
      mutated = true;
    }
  }
  const base = mutated
    ? reanchorEndpointsToSnap(
        { ...layout, components, connectors },
        componentXf,
        connectorXf,
      )
    : layout;
  return updateOwnShapes(base, set.shapes, (s) => {
    const snapped = snapShape(s, grid);
    return snapped === s ? null : snapped;
  });
}

/** The frame shift a grid snap imposes on a placement: a scale-about-centre,
 *  since `snapExtent` rounds each corner independently (degenerates to a pure
 *  translation when both corners shift by the same delta). */
function snapTransform(before: Placement, after: Placement): PointXf {
  return scaleAbout(
    placementCentre(before),
    placementCentre(after),
    extentSpan(before.extent),
    extentSpan(after.extent),
  );
}

/**
 * Re-anchor the terminal waypoint of each connection whose endpoint sits on a
 * just-snapped component / connector, so the wire follows the port through the
 * on-commit grid snap instead of detaching. Only `waypoints[0]` (lhs) and
 * `waypoints[last]` (rhs) are transformed; internal waypoints are left intact,
 * so a user-shaped route survives a snap.
 */
function reanchorEndpointsToSnap(
  layout: DiagramLayout,
  componentXf: Map<string, PointXf>,
  connectorXf: Map<string, PointXf>,
): DiagramLayout {
  if (componentXf.size === 0 && connectorXf.size === 0) {
    return layout;
  }
  let mutated = false;
  const connections = layout.connections.map((conn) => {
    if (conn.waypoints.length < 2) {
      return conn;
    }
    const { lhsXf, rhsXf } = endpointTransforms(conn, componentXf, connectorXf);
    if (!lhsXf && !rhsXf) {
      return conn;
    }
    const waypoints = conn.waypoints.map(([x, y]) => [x, y] as Point);
    const lastIdx = waypoints.length - 1;
    const first = waypoints[0];
    const last = waypoints[lastIdx];
    if (first === undefined || last === undefined) {
      return conn;
    }
    if (lhsXf) waypoints[0] = lhsXf(first);
    if (rhsXf) waypoints[lastIdx] = rhsXf(last);
    mutated = true;
    return { ...conn, waypoints };
  });
  return mutated ? { ...layout, connections } : layout;
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

/**
 * Drags one icon corner of a shape's placement extent to the diagram
 * point (x, y), holding the opposite corner fixed. `applyPlacement` maps
 * icon-left→x1, icon-right→x2, bottom→y1, top→y2 regardless of flip, so
 * each `corner` sets a fixed pair of extent coordinates. Dragging a
 * corner past its anchor inverts an axis — which is exactly a Modelica
 * mirror, so resizing through the opposite edge flips the shape.
 * Rotation is not accounted for — a rotated shape resizes in its
 * unrotated frame.
 *
 * Connections terminating on the resized shape are re-anchored: a port
 * is rigid relative to the icon, so its endpoint scales about the
 * shape's centre by the same signed per-axis factor the extent span
 * changed — negative when an axis flips, which mirrors the endpoint.
 */
export function applyResize(
  layout: DiagramLayout,
  key: string,
  corner: "tl" | "tr" | "bl" | "br",
  x: number,
  y: number,
): DiagramLayout {
  const parsed = parseKey(key);
  if (!parsed) {
    return layout;
  }
  if (parsed.kind === "shape") {
    return updateOwnShapes(layout, new Set([parsed.index]), (s) =>
      resizeShapeExtent(s, corner, x, y),
    );
  }
  const lookup =
    parsed.kind === "component"
      ? layout.components[parsed.nodeId]
      : parsed.kind === "connector"
        ? layout.connectors[parsed.nodeId]
        : undefined;
  if (!lookup) {
    return layout;
  }
  const oldCentre = placementCentre(lookup.placement);
  const newExtent = dragCorner(
    lookup.placement.extent,
    lookup.placement.origin,
    corner,
    x,
    y,
  );
  const newCentre = placementCentre({ ...lookup.placement, extent: newExtent });
  const xf = scaleAbout(
    oldCentre,
    newCentre,
    extentSpan(lookup.placement.extent),
    extentSpan(newExtent),
  );
  const xfMap = new Map<string, PointXf>([[parsed.nodeId, xf]]);
  if (parsed.kind === "component") {
    const placed = applyComponentExtent(layout, parsed.nodeId, newExtent);
    return reanchorConnections(placed, xfMap, new Map());
  }
  const placed = applyConnectorExtent(layout, parsed.nodeId, newExtent);
  return reanchorConnections(placed, new Map(), xfMap);
}

/**
 * Sets each selected shape's placement rotation to an absolute degree
 * value (normalised to [0, 360)). Returns the same reference when no
 * shape's rotation actually changes, so a drag that lands on the
 * current angle commits nothing.
 *
 * Connections terminating on a rotated shape are re-anchored: a port is
 * rigid relative to the icon, so its endpoint rotates about the shape's
 * centre by the same delta (new minus old angle).
 */
export function applyRotation(
  layout: DiagramLayout,
  keys: Iterable<string>,
  degrees: number,
): DiagramLayout {
  const norm = ((degrees % 360) + 360) % 360;
  const set = partitionKeys(keys);
  let mutated = false;
  const componentXf = new Map<string, PointXf>();
  const connectorXf = new Map<string, PointXf>();
  const components = { ...layout.components };
  for (const id of set.components) {
    const c = components[id];
    const old = c?.placement.rotation ?? 0;
    if (!c || old === norm) continue;
    componentXf.set(id, rotateAbout(placementCentre(c.placement), norm - old));
    components[id] = { ...c, placement: { ...c.placement, rotation: norm } };
    mutated = true;
  }
  const connectors = { ...layout.connectors };
  for (const id of set.connectors) {
    const c = connectors[id];
    const old = c?.placement.rotation ?? 0;
    if (!c || old === norm) continue;
    connectorXf.set(id, rotateAbout(placementCentre(c.placement), norm - old));
    connectors[id] = { ...c, placement: { ...c.placement, rotation: norm } };
    mutated = true;
  }
  const base = mutated
    ? reanchorConnections(
        { ...layout, components, connectors },
        componentXf,
        connectorXf,
      )
    : layout;
  return updateOwnShapes(base, set.shapes, (s) => rotateShape(s, norm));
}

// ── Poly vertex ops ──────────────────────────────────────────────────
//
// Line / Polygon are edited per-vertex (no bounding-box resize). A vertex
// is addressed by the shape key plus its index into `points`. Deletes
// respect `POLY_MIN_VERTICES` so a line stays a segment and a polygon a
// triangle — the same floor the draw tool uses.

/**
 * Maps a diagram point into a poly shape's local frame — the frame its
 * `points` live in. Translate by `-origin`, then un-rotate by `-rotation`,
 * inverting the transform the renderer / hit frame applies (`origin` +
 * `R(rotation)·point`). Without the un-rotation, editing a rotated poly's
 * vertices would land them off-cursor.
 */
function toShapeLocal(
  s: Extract<Shape, { kind: "line" | "polygon" }>,
  x: number,
  y: number,
): Point {
  const dx = x - (s.origin?.[0] ?? 0);
  const dy = y - (s.origin?.[1] ?? 0);
  const rot = s.rotation ?? 0;
  if (rot === 0) {
    return [dx, dy];
  }
  const rad = (rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [dx * cos + dy * sin, -dx * sin + dy * cos];
}

/** Resolves `key` to a single own-layer poly shape and replaces it via `fn`
 *  (which returns `null` to leave it unchanged). No-ops for any non-poly or
 *  unresolvable key. */
function updatePolyShape(
  layout: DiagramLayout,
  key: string,
  fn: (poly: Extract<Shape, { kind: "line" | "polygon" }>) => Shape | null,
): DiagramLayout {
  const parsed = parseKey(key);
  if (!parsed || parsed.kind !== "shape" || !Number.isInteger(parsed.index)) {
    return layout;
  }
  return updateOwnShapes(layout, new Set([parsed.index]), (s) =>
    isPolyShape(s) ? fn(s) : null,
  );
}

/** Moves one vertex of a poly shape to (x, y) in diagram coords. */
export function applyShapeVertexDrag(
  layout: DiagramLayout,
  key: string,
  vertexIndex: number,
  x: number,
  y: number,
): DiagramLayout {
  return updatePolyShape(layout, key, (s) => {
    const cur = s.points[vertexIndex];
    if (cur === undefined) {
      return null;
    }
    const [nx, ny] = toShapeLocal(s, x, y);
    if (cur[0] === nx && cur[1] === ny) {
      return null;
    }
    return {
      ...s,
      points: s.points.map((p, i) => (i === vertexIndex ? [nx, ny] : p)),
    };
  });
}

/** Inserts a vertex on the segment of a poly nearest `point`, splitting it.
 *  A polygon also considers its closing edge (last → first). */
export function applyShapeVertexInsert(
  layout: DiagramLayout,
  key: string,
  point: { x: number; y: number },
): DiagramLayout {
  return updatePolyShape(layout, key, (s) => {
    const pts = s.points;
    if (pts.length < 2) {
      return null;
    }
    const [lx, ly] = toShapeLocal(s, point.x, point.y);
    const local = { x: lx, y: ly };
    const segments = s.kind === "polygon" ? pts.length : pts.length - 1;
    let bestAt = 1;
    let bestProj: Point | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < segments; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (a === undefined || b === undefined) {
        continue;
      }
      const proj = projectOntoSegment(a, b, local);
      const dx = proj[0] - local.x;
      const dy = proj[1] - local.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        bestAt = i + 1;
        bestProj = proj;
      }
    }
    if (bestProj === null) {
      return null;
    }
    return {
      ...s,
      points: [...pts.slice(0, bestAt), bestProj, ...pts.slice(bestAt)],
    };
  });
}

/** Removes one vertex of a poly shape, refusing to drop below the kind's
 *  minimum (2 for a line, 3 for a polygon). */
export function applyShapeVertexDelete(
  layout: DiagramLayout,
  key: string,
  vertexIndex: number,
): DiagramLayout {
  return updatePolyShape(layout, key, (s) => {
    if (
      s.points[vertexIndex] === undefined ||
      s.points.length <= POLY_MIN_VERTICES[s.kind]
    ) {
      return null;
    }
    return { ...s, points: s.points.filter((_, i) => i !== vertexIndex) };
  });
}

/** Toggles a poly shape's `smooth` between Bezier and straight segments. */
export function applyShapeSmoothToggle(
  layout: DiagramLayout,
  key: string,
): DiagramLayout {
  return updatePolyShape(layout, key, (s) => ({
    ...s,
    smooth: s.smooth === "Bezier" ? "None" : "Bezier",
  }));
}

/** Maps a diagram point rigidly attached to a transformed shape from
 *  its old to its new position. */
type PointXf = (p: Point) => Point;

/** Signed extent span (x2 − x1, y2 − y1). Sign carries flip state, so a
 *  span ratio across a resize is negative when that axis mirrors. A `0`
 *  span falls back to `1` to keep the ratio finite — re-anchoring a
 *  connection off a degenerate (zero-width/height) shape is then
 *  best-effort, which is acceptable since such a shape isn't reachable
 *  by normal dragging. */
function extentSpan(extent: Extent): { w: number; h: number } {
  return {
    w: extent[1][0] - extent[0][0] || 1,
    h: extent[1][1] - extent[0][1] || 1,
  };
}

function rotateAbout(centre: Point, deg: number): PointXf {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const [cx, cy] = centre;
  return ([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  };
}

function scaleAbout(
  oldCentre: Point,
  newCentre: Point,
  oldSize: { w: number; h: number },
  newSize: { w: number; h: number },
): PointXf {
  const sx = newSize.w / oldSize.w;
  const sy = newSize.h / oldSize.h;
  const [ocx, ocy] = oldCentre;
  const [ncx, ncy] = newCentre;
  return ([x, y]) => [ncx + (x - ocx) * sx, ncy + (y - ocy) * sy];
}

/**
 * Re-anchors the endpoints of every connection terminating on a
 * transformed shape, then re-routes that connection orthogonally
 * between its (possibly new) endpoints. `componentXf` / `connectorXf`
 * map an affected shape id to the transform its rigid points undergo.
 *
 * Re-routing discards any user-placed internal junctions on an affected
 * connection — the same trade-off `applyDeltaMove` makes when only one
 * endpoint moves; the alternative (rigidly carrying junctions) would
 * tilt segments off-axis once an endpoint rotates or scales.
 */
/**
 * The transforms to apply to a connection's lhs / rhs endpoints, resolved from
 * the per-entity frame-change maps. A port sits on a sub-component
 * (`endpoint.component`) or a standalone connector (`endpoint.port`); `undefined`
 * means that endpoint's entity didn't move.
 */
function endpointTransforms(
  conn: ConnectionLayout,
  componentXf: Map<string, PointXf>,
  connectorXf: Map<string, PointXf>,
): { lhsXf: PointXf | undefined; rhsXf: PointXf | undefined } {
  const resolve = (ep: ConnectionEndpoint): PointXf | undefined =>
    ep.component !== undefined
      ? componentXf.get(ep.component)
      : connectorXf.get(ep.port);
  return { lhsXf: resolve(conn.lhs), rhsXf: resolve(conn.rhs) };
}

function reanchorConnections(
  layout: DiagramLayout,
  componentXf: Map<string, PointXf>,
  connectorXf: Map<string, PointXf>,
): DiagramLayout {
  if (componentXf.size === 0 && connectorXf.size === 0) {
    return layout;
  }
  let mutated = false;
  const connections = layout.connections.map((conn) => {
    if (conn.waypoints.length < 2) {
      return conn;
    }
    const { lhsXf, rhsXf } = endpointTransforms(conn, componentXf, connectorXf);
    if (!lhsXf && !rhsXf) {
      return conn;
    }
    const first = conn.waypoints[0];
    const last = conn.waypoints.at(-1);
    if (first === undefined || last === undefined) {
      return conn;
    }
    const from = lhsXf ? lhsXf(first) : first;
    const to = rhsXf ? rhsXf(last) : last;
    mutated = true;
    return {
      ...conn,
      waypoints: orthogonalRoute(
        { x: from[0], y: from[1] },
        { x: to[0], y: to[1] },
      ),
    };
  });
  return mutated ? { ...layout, connections } : layout;
}

/**
 * Placement centre of the component / connector addressed by `key`, in
 * the parent's diagram coords. `null` when the key isn't a shape that
 * exists in the layout. Used as the pivot for drag-to-rotate.
 */
export function shapeCentre(layout: DiagramLayout, key: string): Point | null {
  const parsed = parseKey(key);
  if (!parsed) return null;
  if (parsed.kind === "component") {
    const c = layout.components[parsed.nodeId];
    return c ? placementCentre(c.placement) : null;
  }
  if (parsed.kind === "connector") {
    const c = layout.connectors[parsed.nodeId];
    return c ? placementCentre(c.placement) : null;
  }
  if (parsed.kind === "shape") {
    const own = ownLayer(layout);
    const s = own?.shapes[parsed.index];
    return s ? shapeCentreOf(s) : null;
  }
  return null;
}

/**
 * Filters `keys` down to those still backed by an entity in `layout`:
 * a component / connector by id, or a host shape by its own-layer
 * `(kind, index)`. Selection survives an in-place edit (move / rotate /
 * resize echoed back from the host) but drops anything the layout no
 * longer contains. Edge / junction keys, whose indices can shift on
 * relayout, are not retained.
 */
export function retainExistingSelection(
  layout: DiagramLayout,
  keys: Iterable<string>,
): Set<string> {
  const out = new Set<string>();
  for (const k of keys) {
    const parsed = parseKey(k);
    if (!parsed) continue;
    if (parsed.kind === "component" && layout.components[parsed.nodeId]) {
      out.add(k);
    } else if (
      parsed.kind === "connector" &&
      layout.connectors[parsed.nodeId]
    ) {
      out.add(k);
    } else if (parsed.kind === "shape") {
      // Positional re-key: keep the selection only if the same own-layer
      // index still holds a shape of the same kind after a refetch.
      const own = ownLayer(layout);
      if (own?.shapes[parsed.index]?.kind === parsed.shapeKind) {
        out.add(k);
      }
    }
  }
  return out;
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
    set.connections.size === 0 &&
    set.shapes.size === 0
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
  const base = { ...layout, components, connectors, connections };
  if (set.shapes.size === 0) {
    return base;
  }
  const own = ownLayer(base);
  if (!own) {
    return base;
  }
  const shapes = own.shapes.filter((_, i) => !set.shapes.has(i));
  return shapes.length === own.shapes.length
    ? base
    : replaceOwnShapes(base, own.field, own.index, shapes);
}

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
 * keeping the route orthogonal (Manhattan): a horizontal segment moves
 * only vertically, a vertical one only horizontally — the parallel-axis
 * delta is ignored. When the grabbed segment touches an anchored
 * endpoint (`waypoints[0]` or the last waypoint), a perpendicular jog
 * waypoint is inserted so the endpoint stays pinned to its connector.
 * Coincident / collinear waypoints the drag produces are collapsed, so
 * repeated drags don't accumulate cruft.
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

  return commitReshape(layout, connIdx, conn, [...left, p, q, ...right]);
}

function waypointsWithJog(
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
  if (prev === undefined || curr === undefined || next === undefined)
    return null;
  const moved: Point = [curr[0] + dx, curr[1] + dy];
  const inJog = jogFromStart(prev, moved, segmentAxis(prev, curr));
  const outJog = jogToEnd(moved, next, segmentAxis(curr, next));
  return [
    ...waypoints.slice(0, idx - 1),
    prev,
    inJog,
    moved,
    outJog,
    next,
    ...waypoints.slice(idx + 2),
  ];
}

/**
 * Drags a single internal waypoint, keeping the route orthogonal: each
 * adjacent segment is reconnected to its fixed neighbour through a
 * perpendicular jog (inserted only when the neighbour doesn't already
 * line up — `simplifyOrthogonalPath` drops the redundant ones). Endpoint
 * waypoints anchor to their connectors and aren't draggable.
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
  const candidate = waypointsWithJog(conn.waypoints, waypointIdx, dx, dy);
  if (candidate === null) {
    return layout;
  }
  return commitReshape(layout, connIdx, conn, candidate);
}

/**
 * Simplify `candidate` into a clean orthogonal route and store it on
 * `connIdx`. Returns the original `layout` reference when the result is
 * identical to the connection's current waypoints, so `commitLayout`
 * can skip the change event.
 */
function commitReshape(
  layout: DiagramLayout,
  connIdx: number,
  conn: DiagramLayout["connections"][number],
  candidate: Point[],
): DiagramLayout {
  const waypoints = simplifyOrthogonalPath(candidate);
  if (pointsEqual(waypoints, conn.waypoints)) {
    return layout;
  }
  return replaceConnection(layout, connIdx, { ...conn, waypoints });
}

type Axis = "h" | "v";

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
    const proj = projectOntoSegment(a, b, point);
    const dx = proj[0] - point.x;
    const dy = proj[1] - point.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
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
  conn: DiagramLayout["connections"][number],
): DiagramLayout {
  const connections = layout.connections.map((c, i) =>
    i === connIdx ? conn : c,
  );
  return { ...layout, connections };
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
    const proj = projectOntoSegment(a, b, point);
    const dx = proj[0] - point.x;
    const dy = proj[1] - point.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/** Closest point to `p` on the segment `a`–`b`, clamped to the segment. */
function projectOntoSegment(
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
  const base = forEachShape(layout, keys, (p) => ({
    ...p,
    rotation: ((p.rotation ?? 0) + delta + 360) % 360,
  }));
  const set = partitionKeys(keys);
  return updateOwnShapes(base, set.shapes, (s) =>
    rotateShape(s, ((((s.rotation ?? 0) + delta) % 360) + 360) % 360),
  );
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
  const base = forEachShape(layout, keys, (p) => ({
    ...p,
    extent: flipExtent(p.extent, horizontal),
  }));
  const set = partitionKeys(keys);
  return updateOwnShapes(base, set.shapes, (s) => flipShape(s, horizontal));
}

/** Mirrors an extent about its own centre by swapping one axis' corners. */
function flipExtent(extent: Extent, horizontal: boolean): Extent {
  const [[x1, y1], [x2, y2]] = extent;
  return horizontal
    ? [
        [x2, y1],
        [x1, y2],
      ]
    : [
        [x1, y2],
        [x2, y1],
      ];
}

/** Mirrors a shape in place: extent shapes swap an extent axis, poly shapes
 *  reflect every vertex about their bounding-box centre. */
function flipShape(s: Shape, horizontal: boolean): Shape {
  if (!isPolyShape(s)) {
    return { ...s, extent: flipExtent(s.extent, horizontal) };
  }
  if (s.points.length === 0) {
    return s;
  }
  const xs = s.points.map((p) => p[0]);
  const ys = s.points.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return {
    ...s,
    points: s.points.map(([x, y]) =>
      horizontal ? [2 * cx - x, y] : [x, 2 * cy - y],
    ),
  };
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

const DRAWN_LINE_COLOR: Color = [0, 0, 0];

/** Build a default extent primitive for a freshly-drawn shape. */
export function buildExtentShape(kind: ExtentKind, extent: Extent): Shape {
  return kind === "rectangle"
    ? { kind: "rectangle", extent, lineColor: DRAWN_LINE_COLOR }
    : { kind: "ellipse", extent, lineColor: DRAWN_LINE_COLOR };
}

/**
 * Build a default poly primitive for a freshly-drawn shape. A `line` stays
 * open; a `polygon` is closed by the renderer, so `points` carries only the
 * distinct vertices — no duplicated closing point.
 */
export function buildPolyShape(kind: PolyKind, points: Point[]): Shape {
  return kind === "line"
    ? { kind: "line", points, color: DRAWN_LINE_COLOR }
    : { kind: "polygon", points, lineColor: DRAWN_LINE_COLOR };
}

/**
 * Append a graphic to the host class's OWN layer (`from === className`),
 * creating that layer when the class has no graphics yet. Inherited ancestor
 * layers are never touched — only the host's own graphics are editable, which
 * is also what the persist path (`writeClassGraphics`) writes.
 */
export function applyAddGraphic(
  layout: DiagramLayout,
  layer: "icon" | "diagram",
  shape: Shape,
): DiagramLayout {
  const field = layer === "icon" ? "iconLayers" : "diagramLayers";
  const layers = layout[field];
  const idx = layers.findIndex((l) => l.from === layout.className);
  if (idx < 0) {
    const own: IconLayer = { from: layout.className, shapes: [shape] };
    return { ...layout, [field]: [...layers, own] };
  }
  const next = layers.map((l, i) =>
    i === idx ? { ...l, shapes: [...l.shapes, shape] } : l,
  );
  return { ...layout, [field]: next };
}
