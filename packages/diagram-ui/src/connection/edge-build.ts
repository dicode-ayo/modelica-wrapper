import { Container, Graphics } from "pixi.js";
import type { Point } from "@dicode/omc-client";

import { buildHitTube } from "../base/hit-tube.js";

/**
 * Pure builder for a connection's stroked path. The visible stroke is a
 * single `Graphics` polyline drawn with `pixelLine` — a crisp 1-device-
 * pixel line at every zoom, matching OMEdit's look.
 *
 * A thin line is hard to land a pick on, so the builder also returns an
 * invisible `Graphics` "hit band" (`buildHitTube`, shared with poly host
 * shapes): a fat round-capped stroke at `2 * hitRadius` backed by an
 * explicit point-to-segment `hitArea`, drawn at `alpha = 0`. A caller
 * raises its alpha to reveal a hover band. Both share the same entity tag
 * so the picker resolves the same edge either way.
 *
 * `clocked` swaps the visible stroke to a hand-rolled dashed pattern for
 * the Modelica synchronous-clock convention (Pixi v8 has no native dash).
 */
export interface EdgeOptions {
  points: Point[];
  /** Stroke colour as 0xRRGGBB. */
  color?: number;
  clocked?: boolean;
  /**
   * Paint-order offset. Negated into a `zIndex` so the wire sits in front
   * of components (`zIndex 0`) even where it crosses one.
   */
  zOffset?: number;
  /**
   * Radius of the picking band around each segment, in diagram units.
   * Doubles as the hover-band half-width, so it tracks the waypoint disc
   * radius (`WAYPOINT_RADIUS`) and the two read as one shape.
   */
  hitRadius?: number;
}

/** Default edge colour (near-black slate), matching the junction disc. */
export const DEFAULT_EDGE_COLOR = 0x1a1a2e;
export const EDGE_Z_OFFSET = -0.005;

/**
 * Radius of a connection waypoint, in diagram units. Shared by the
 * junction discs and the edge pick band so the hover band lines up with
 * the discs sitting on it.
 */
export const WAYPOINT_RADIUS = 1.5;
const DEFAULT_HIT_RADIUS = WAYPOINT_RADIUS;

/** Alpha the pick band renders at while its edge is hovered. */
export const HIT_HOVER_OPACITY = 0.3;
/** Blue-500 hover band, matching the selection accent. */
const HIT_HOVER_COLOR = 0x3d82f5;

/** Dash sizing tuned for diagram-coord paths (tens of units long). */
const DEFAULT_DASH_SIZE = 4;
const DEFAULT_DASH_GAP = 3;
/** Dash count distributed across the whole path, not an absolute length —
 *  keeps the dash density stable across variable path lengths. */
const DEFAULT_DASH_COUNT = 24;

export interface EdgeMeshes {
  /** Visible stroked polyline. Decorative — picks land on `hitArea`. */
  line: Graphics;
  /** Invisible follow-the-line band the picker actually hits. */
  hitArea: Graphics;
}

export function buildEdge(
  parent: Container | null,
  name: string,
  options: EdgeOptions,
): EdgeMeshes | null {
  if (options.points.length < 2) {
    return null;
  }
  const color = options.color ?? DEFAULT_EDGE_COLOR;
  const zIndex = -(options.zOffset ?? EDGE_Z_OFFSET);

  const line = new Graphics({ label: name });
  line.eventMode = "none";
  line.zIndex = zIndex;
  drawEdgeLine(line, options.points, color, options.clocked ?? false);

  const hitArea = buildHitTube(
    `${name}.hit`,
    options.points,
    options.hitRadius ?? DEFAULT_HIT_RADIUS,
    HIT_HOVER_COLOR,
  );
  hitArea.zIndex = zIndex;

  if (parent) {
    parent.sortableChildren = true;
    parent.addChild(line, hitArea);
  }
  return { line, hitArea };
}

/**
 * Redraw the visible line in place against a new point set and colour.
 * Operating on the same `Graphics` keeps its identity tag and parent
 * linkage, so a component drag (which shifts every connected edge each
 * pointermove) doesn't churn the scene graph.
 */
export function updateEdgePoints(
  line: Graphics,
  newPoints: Point[],
  color: number,
  clocked: boolean,
): void {
  drawEdgeLine(line, newPoints, color, clocked);
}

/**
 * Build a fresh hit band against a new point set. The hit area is an
 * `IHitArea` recomputed from the points, so the band is rebuilt rather
 * than mutated in place; the caller re-tags it and swaps it for the old
 * one (no manual metadata copy — the tag is reapplied via `tagEntity`).
 */
export function rebuildHitTube(
  parent: Container | null,
  name: string,
  newPoints: Point[],
  hitRadius: number = DEFAULT_HIT_RADIUS,
  zOffset: number = EDGE_Z_OFFSET,
): Graphics {
  const hitArea = buildHitTube(name, newPoints, hitRadius, HIT_HOVER_COLOR);
  hitArea.zIndex = -zOffset;
  if (parent) {
    parent.sortableChildren = true;
    parent.addChild(hitArea);
  }
  return hitArea;
}

function drawEdgeLine(
  line: Graphics,
  points: Point[],
  color: number,
  clocked: boolean,
): void {
  line.clear();
  if (clocked) {
    appendDashedPath(line, points);
  } else {
    appendSolidPath(line, points);
  }
  line.stroke({ width: 1, color, pixelLine: true, alignment: 0.5 });
}

function appendSolidPath(g: Graphics, points: Point[]): void {
  const first = points[0];
  if (first === undefined) {
    return;
  }
  g.moveTo(first[0], first[1]);
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p === undefined) {
      continue;
    }
    g.lineTo(p[0], p[1]);
  }
}

/**
 * Hand-rolled dash segmentation mirroring Babylon's `CreateDashedLines`:
 * one dash+gap period spans `totalLength / dashNb`, the drawn run is
 * `dashSize / (dashSize + gapSize)` of it, and the phase restarts at each
 * vertex (dashes break at corners). Reproduced so the dashed pattern
 * matches the pre-migration baseline.
 */
function appendDashedPath(g: Graphics, points: Point[]): void {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) {
      continue;
    }
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  if (total <= 0) {
    return;
  }
  const period = total / DEFAULT_DASH_COUNT;
  const run =
    (DEFAULT_DASH_SIZE * period) / (DEFAULT_DASH_SIZE + DEFAULT_DASH_GAP);
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) {
      continue;
    }
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) {
      continue;
    }
    const nx = dx / len;
    const ny = dy / len;
    const count = Math.floor(len / period);
    for (let j = 0; j < count; j++) {
      const start = period * j;
      g.moveTo(a[0] + start * nx, a[1] + start * ny);
      g.lineTo(a[0] + (start + run) * nx, a[1] + (start + run) * ny);
    }
  }
}
