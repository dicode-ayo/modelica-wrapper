import type {
  DiagramLayout,
  Extent,
  Placement,
  Point,
} from "@modelica-wrapper/omc-client";

import { parseKey, type EntityKind } from "./node-keys.js";

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
      const waypoints = conn.waypoints.map((wp, i) => {
        const moveByJunction = wpIdxs?.has(i) ?? false;
        const moveByLhs = i === 0 && lhsMoves;
        const moveByRhs = i === lastIdx && rhsMoves;
        if (moveByJunction || moveByLhs || moveByRhs) {
          return [wp[0] + dx, wp[1] + dy] as Point;
        }
        return wp;
      });
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
