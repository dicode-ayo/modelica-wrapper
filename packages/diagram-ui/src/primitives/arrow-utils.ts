import { Container, Graphics } from "pixi.js";
import type { Color } from "@dicode/omc-client";

import { packColor, type OwnedResource } from "./shape-utils.js";

/** Modelica default `arrowSize` in diagram units (§18.6.4). */
export const DEFAULT_ARROW_SIZE = 3.0;

const ARROW_HALF_ANGLE_RAD = 15 * (Math.PI / 180);

/**
 * Pure geometry for one Modelica arrowhead: tip and two base corners.
 *
 * `(dirX, dirY)` must be a unit vector pointing FROM the shaft TOWARD the
 * tip. `size` is the arrowhead length in diagram units. The two base corners
 * sit symmetrically about the shaft at ±15° from the centreline.
 */
export function arrowheadVertices(
  tip: readonly [number, number],
  dirX: number,
  dirY: number,
  size: number,
): { tip: [number, number]; left: [number, number]; right: [number, number] } {
  const hw = size * Math.tan(ARROW_HALF_ANGLE_RAD);
  const bx = tip[0] - dirX * size;
  const by = tip[1] - dirY * size;
  // Perpendicular to the direction (CCW rotation by 90°)
  const px = -dirY;
  const py = dirX;
  return {
    tip: [tip[0], tip[1]],
    left: [bx + px * hw, by + py * hw],
    right: [bx - px * hw, by - py * hw],
  };
}

/**
 * Build one Modelica arrowhead as a `Graphics` child of `parent`, at `tip`,
 * pointing in direction `(dirX, dirY)` (normalised internally). `size` is in
 * the same diagram-unit coordinate space as the line's own points — unlike
 * stroke `thickness`, `arrowSize` is not screen-space compensated.
 *
 * `Arrow.None`, a zero-length direction, or a non-positive size each return
 * null. Supports `"Filled"` (solid triangle), `"Open"` (hollow V chevron),
 * and `"Half"` (single-sided wing, drawn on the CCW/left side — Modelica
 * §18.6.4 says "right side of a filled arrow" without defining an
 * orientation convention; unverified against OMEdit). Unknown values return
 * null. `strokeWidth` (already scale-compensated, see
 * {@link resolveStrokeWidth}) is the outline width for `"Open"`/`"Half"`;
 * `"Filled"` ignores it (solid fill has no stroke).
 */
export function buildArrowhead(
  parent: Container,
  tip: readonly [number, number],
  dirX: number,
  dirY: number,
  size: number,
  kind: string,
  color: Color,
  z: number,
  baseName: string,
  strokeWidth: number,
): OwnedResource | null {
  if (!kind || kind === "None" || !(size > 0)) return null;
  const len = Math.hypot(dirX, dirY);
  if (!(len > 0)) return null;

  const nx = dirX / len;
  const ny = dirY / len;
  const v = arrowheadVertices(tip, nx, ny, size);
  const colour = packColor(color);

  const g = new Graphics({ label: baseName });
  g.eventMode = "none";
  g.zIndex = z;

  if (kind === "Filled") {
    g.poly([v.tip[0], v.tip[1], v.left[0], v.left[1], v.right[0], v.right[1]]);
    g.fill(colour);
  } else if (kind === "Open") {
    g.moveTo(v.left[0], v.left[1])
      .lineTo(v.tip[0], v.tip[1])
      .lineTo(v.right[0], v.right[1]);
    g.stroke({
      width: strokeWidth,
      color: colour,
      cap: "round",
      join: "round",
    });
  } else if (kind === "Half") {
    g.moveTo(v.tip[0], v.tip[1]).lineTo(v.left[0], v.left[1]);
    g.stroke({
      width: strokeWidth,
      color: colour,
      cap: "round",
      join: "round",
    });
  } else {
    g.destroy();
    return null;
  }

  parent.addChild(g);
  return { dispose: () => g.destroy() };
}
