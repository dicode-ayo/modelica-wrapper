import { Graphics, type IHitArea } from "pixi.js";

import type { Point } from "@dicode/omc-client";

/**
 * Builds one invisible, pickable `Graphics` covering every segment of a
 * polyline — a "hit tube" that gives a thin line a grabbable band the
 * picker can land on (a zero-width stroke reports unreliable bounds).
 *
 * The band is a single round-capped/joined stroke at `2 * radius`, drawn
 * at `alpha = 0` so it stays invisible yet hit-testable; a caller raises
 * `alpha` to reveal it as a hover band in `color`. Picking is backed by an
 * explicit `hitArea` (point-to-segment distance ≤ `radius`) so a hit
 * lands anywhere along the route regardless of the rendered stroke bounds.
 *
 * Shared by connection edges and poly host shapes so both get the same
 * follow-the-line pick behaviour.
 *
 * `excludeEnds` carves a `radius` disc around each terminal point out of
 * the hit area. A connection route terminates at the centre of the entity
 * it lands on, so without the exclusion the band swallows every pick on
 * that spot — which belongs to the connector, not the edge. Poly host
 * shapes keep the full band: their tips terminate on nothing.
 */
export function buildHitTube(
  name: string,
  points: ReadonlyArray<Point>,
  radius: number,
  color: number,
  excludeEnds = false,
): Graphics {
  const g = new Graphics({ label: name });
  g.alpha = 0;

  const first = points[0];
  if (first === undefined || points.length < 2) {
    return g;
  }
  g.moveTo(first[0], first[1]);
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p === undefined) {
      continue;
    }
    g.lineTo(p[0], p[1]);
  }
  g.stroke({ width: 2 * radius, color, cap: "round", join: "round" });
  g.eventMode = "static";
  g.hitArea = new PolylineHitArea(points, radius, excludeEnds);
  return g;
}

/**
 * Hit area matching a stroked polyline: a point is inside when it lies
 * within `radius` of any segment. Precise at bends (a single offset
 * polygon would leave dead zones at corners), and renderer-free so the
 * pick works headless. With `excludeEnds`, a point within `radius` of a
 * terminal point is outside regardless of the segment test.
 */
class PolylineHitArea implements IHitArea {
  private readonly radiusSq: number;

  constructor(
    private readonly points: ReadonlyArray<Point>,
    radius: number,
    private readonly excludeEnds = false,
  ) {
    this.radiusSq = radius * radius;
  }

  contains(x: number, y: number): boolean {
    if (this.excludeEnds) {
      const first = this.points[0];
      const last = this.points.at(-1);
      if (first && distSq(x, y, first[0], first[1]) <= this.radiusSq) {
        return false;
      }
      if (last && distSq(x, y, last[0], last[1]) <= this.radiusSq) {
        return false;
      }
    }
    for (let i = 0; i + 1 < this.points.length; i++) {
      const a = this.points[i];
      const b = this.points[i + 1];
      if (a === undefined || b === undefined) {
        continue;
      }
      if (distSqToSegment(x, y, a[0], a[1], b[0], b[1]) <= this.radiusSq) {
        return true;
      }
    }
    return false;
  }
}

function distSq(px: number, py: number, x: number, y: number): number {
  return (px - x) ** 2 + (py - y) ** 2;
}

function distSqToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return (px - ax) ** 2 + (py - ay) ** 2;
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
}
