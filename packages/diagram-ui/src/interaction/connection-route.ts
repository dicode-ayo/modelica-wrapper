import type { Point } from "@modelica-wrapper/omc-client";

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
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = b[i]!;
    if (p[0] !== q[0] || p[1] !== q[1]) return false;
  }
  return true;
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
