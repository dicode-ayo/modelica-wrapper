import type { Container } from "pixi.js";

/** Label of the worldRoot container, which carries the pan/zoom view transform. */
const WORLD_ROOT_LABEL = "om-world";

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
  let sx = 1;
  let sy = 1;
  let cur: Container | null = node;
  while (cur && cur.label !== WORLD_ROOT_LABEL) {
    sx *= Math.abs(cur.scale.x);
    sy *= Math.abs(cur.scale.y);
    cur = cur.parent;
  }
  return { x: sx || 1, y: sy || 1 };
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
  let sx = 1;
  let sy = 1;
  let cur: Container | null = node;
  while (cur && cur.label !== WORLD_ROOT_LABEL) {
    if (cur.scale.x < 0) sx = -sx;
    if (cur.scale.y < 0) sy = -sy;
    cur = cur.parent;
  }
  return { x: sx, y: sy };
}
