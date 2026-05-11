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

interface KeySet {
  components: Set<string>;
  connectors: Set<string>;
  connections: Set<number>;
}

function partitionKeys(keys: Iterable<string>): KeySet {
  const out: KeySet = {
    components: new Set(),
    connectors: new Set(),
    connections: new Set(),
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
    case "edge":
    case "junction":
      // Stored as index into layout.connections.
      const idx = Number(id);
      if (!Number.isNaN(idx)) {
        out.connections.add(idx);
      }
      break;
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
  // Connection waypoints aren't moved on delta — that's E4 territory
  // (edge dragging). Selecting connections + components together still
  // moves the components but leaves the connection paths untouched,
  // which matches OMEdit's behaviour.
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
