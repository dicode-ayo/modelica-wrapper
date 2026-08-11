import type {
  DiagramLayout,
  Extent,
  Placement,
  Point,
  Shape,
} from "@dicode/omc-client";

import { placementCentre } from "../base/placement-math.js";
import { formatShapeKey, parseKey } from "./entity-keys.js";
import { isPolyShape, ownLayer } from "./own-layer.js";

/**
 * Derives selections from a layout. These return `Set<string>` of entity
 * keys, never a layout: what the user selects is a view over the layout,
 * and nothing here edits one.
 */

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

/** Axis-aligned bounds of local `points` placed at `pivot` and rotated about
 *  it by `deg`. */
function boundsOf(
  points: readonly Point[],
  pivot: Point,
  deg: number,
): DiagramRect {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of points) {
    xs.push(pivot[0] + x * cos - y * sin);
    ys.push(pivot[1] + x * sin + y * cos);
  }
  return {
    x1: Math.min(...xs),
    y1: Math.min(...ys),
    x2: Math.max(...xs),
    y2: Math.max(...ys),
  };
}

function cornersOf(extent: Extent): Point[] {
  const [[x1, y1], [x2, y2]] = extent;
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
}

/**
 * A placement rotates about its extent centre, not its origin — that is where
 * `applyPlacement` anchors the transform node and where `applyRotation`
 * re-anchors connections. Pivoting at the origin instead puts an off-centre
 * extent, which is what a boundary connector has, on the wrong side of the
 * diagram.
 */
function placementBounds(p: Placement): DiagramRect {
  const [[x1, y1], [x2, y2]] = p.extent;
  const halfW = (x2 - x1) / 2;
  const halfH = (y2 - y1) / 2;
  return boundsOf(
    [
      [-halfW, -halfH],
      [halfW, -halfH],
      [halfW, halfH],
      [-halfW, halfH],
    ],
    placementCentre(p),
    p.rotation ?? 0,
  );
}

/** A host shape sits at its `origin` and rotates about it, per
 *  `setDiagramBounds`. A poly is bounded by its points, not its stroke path,
 *  so a band clipping only the drawn width of a line misses it. */
function shapeBoundsOf(s: Shape): DiagramRect {
  const origin: Point = [s.origin?.[0] ?? 0, s.origin?.[1] ?? 0];
  if (isPolyShape(s)) {
    return s.points.length === 0
      ? { x1: origin[0], y1: origin[1], x2: origin[0], y2: origin[1] }
      : boundsOf(s.points, origin, s.rotation ?? 0);
  }
  return boundsOf(cornersOf(s.extent), origin, s.rotation ?? 0);
}

/** Whether two axis-aligned rects share any area, edges included. */
function rectsOverlap(a: DiagramRect, b: DiagramRect): boolean {
  return a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1;
}

/**
 * Returns the keys of every component, connector and own-layer shape the band
 * touches. Overlap decides rather than centre-containment: an entity placed on
 * the class boundary has its centre outside any band drawable over the canvas.
 *
 * Connections aren't selected by rubber-band — their waypoints would force
 * extra geometry awareness.
 *
 * Inherited shapes are excluded: only the host's own layer is editable, so
 * selecting one would offer operations that cannot apply to it.
 */
export function selectByDiagramRect(
  layout: DiagramLayout,
  rect: DiagramRect,
): Set<string> {
  const r = normaliseRect(rect);
  const keys = new Set<string>();
  for (const [id, c] of Object.entries(layout.components)) {
    if (rectsOverlap(r, placementBounds(c.placement))) {
      keys.add(`c:${id}`);
    }
  }
  for (const [id, c] of Object.entries(layout.connectors)) {
    if (rectsOverlap(r, placementBounds(c.placement))) {
      keys.add(`k:${id}`);
    }
  }
  const own = ownLayer(layout);
  own?.shapes.forEach((shape, index) => {
    if (rectsOverlap(r, shapeBoundsOf(shape))) {
      keys.add(formatShapeKey(shape.kind, index));
    }
  });
  return keys;
}

/**
 * Every selectable entity in the layout, regardless of where it sits. A
 * rubber band can only take what it covers, and a class routinely places
 * connectors and labels outside its own coordinate system.
 */
export function selectAllKeys(layout: DiagramLayout): Set<string> {
  const keys = new Set<string>();
  for (const id of Object.keys(layout.components)) keys.add(`c:${id}`);
  for (const id of Object.keys(layout.connectors)) keys.add(`k:${id}`);
  const own = ownLayer(layout);
  own?.shapes.forEach((shape, index) => {
    keys.add(formatShapeKey(shape.kind, index));
  });
  return keys;
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
