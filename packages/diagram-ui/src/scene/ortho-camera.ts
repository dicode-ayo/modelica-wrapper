import type { Container } from "pixi.js";

/** Label of the worldRoot container, which carries the pan/zoom view transform. */
export const WORLD_ROOT_LABEL = "om-world";

/**
 * Absolute diagram-space scale of a container: the product of local
 * scales from `node` up to (but excluding) the worldRoot, so the
 * pan/zoom view transform is left out. Containers parented under a
 * scaled-down component carry the icon→placement scale (commonly ≪ 1);
 * divide a screen-constant size by this to resolve it through that
 * scale. A flip negates an axis; magnitude is what matters, so the sign
 * is dropped.
 */
export function worldScaleXY(node: Container): { x: number; y: number } {
  const { magX, magY } = accumulateToWorldRoot(node);
  return { x: magX || 1, y: magY || 1 };
}

/**
 * Per-axis sign of the accumulated scale from `node` up to (but
 * excluding) the worldRoot: `-1` where an ancestor inverts that axis,
 * `1` otherwise.
 *
 * The only ancestors that carry a negative scale are mirrored component
 * placements — `placementTransform` derives a signed scale from the
 * Modelica extent, so `x2 < x1` mirrors horizontally and `y2 < y1`
 * vertically. Stopping below the worldRoot excludes the pan/zoom view
 * transform and its Y-flip, which every drawn shape shares and which
 * callers cancel separately.
 */
export function placementMirrorSigns(node: Container): {
  x: number;
  y: number;
} {
  const { signX, signY } = accumulateToWorldRoot(node);
  return { x: signX, y: signY };
}

/**
 * Single walk backing {@link worldScaleXY} and {@link placementMirrorSigns},
 * so the stop-below-worldRoot rule has one definition.
 *
 * Sign is tracked as a parity toggle rather than derived from the signed
 * product: a deep chain of small scales can underflow the product to zero,
 * which would lose the mirror bit that {@link placementMirrorSigns} exists
 * to report.
 */
function accumulateToWorldRoot(node: Container): {
  magX: number;
  magY: number;
  signX: number;
  signY: number;
} {
  let magX = 1;
  let magY = 1;
  let signX = 1;
  let signY = 1;
  let cur: Container | null = node;
  while (cur && cur.label !== WORLD_ROOT_LABEL) {
    magX *= Math.abs(cur.scale.x);
    magY *= Math.abs(cur.scale.y);
    if (cur.scale.x < 0) signX = -signX;
    if (cur.scale.y < 0) signY = -signY;
    cur = cur.parent;
  }
  return { magX, magY, signX, signY };
}
