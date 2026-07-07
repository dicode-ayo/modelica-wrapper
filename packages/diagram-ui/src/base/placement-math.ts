import type { CoordinateSystem, Placement } from "@dicode/omc-client";

/**
 * Pure placement-math used by the shape elements. Converts a Modelica
 * `Placement` + `CoordinateSystem` (host class's icon coord system)
 * into the position / rotation / scale we apply to the entity's
 * `TransformNode`.
 *
 * Convention summary:
 *  - Modelica icons live in the coord system declared by the encapsulating
 *    class (`CoordinateSystem.extent`, default `[[-100,-100],[100,100]]`).
 *  - A `Placement.transformation` has an `extent` (in the parent class's
 *    coord system, relative to `origin`) and a `rotation` in degrees (CCW
 *    positive), with rotation applied around `origin`.
 *
 * For C2 we collapse the simple but very common case where `origin` is
 * unset (or equal to `(0, 0)`): we then anchor the TransformNode at the
 * placement-extent centre and rotate around that. When `origin` is set
 * we anchor at `origin` and offset the icon mesh by `extentCenter -
 * origin` inside the TransformNode so the rotation pivots correctly.
 */

export interface AppliedTransform {
  /** World position the TransformNode is set to. */
  position: { x: number; y: number; z: number };
  /** Z-axis rotation in radians applied to the TransformNode. */
  rotationZ: number;
  /** Per-axis scaling that maps icon-coord units to placement units. */
  scale: { x: number; y: number; z: number };
  /** Local-space offset of the icon mesh inside the TransformNode (icon coords). */
  meshLocal: { x: number; y: number };
  /** Icon-coord-system size (`extent.x2 - extent.x1`, same for y). */
  iconSize: { width: number; height: number };
}

const DEFAULT_COORD_SYSTEM_EXTENT_HALF = 100;

export function defaultCoordSystemSize(): { width: number; height: number } {
  return {
    width: 2 * DEFAULT_COORD_SYSTEM_EXTENT_HALF,
    height: 2 * DEFAULT_COORD_SYSTEM_EXTENT_HALF,
  };
}

export function coordSystemSize(cs: CoordinateSystem | undefined): {
  width: number;
  height: number;
  cx: number;
  cy: number;
} {
  const e = cs?.extent;
  if (!e || e.length < 2) {
    return { ...defaultCoordSystemSize(), cx: 0, cy: 0 };
  }
  const [a, b] = e as [number[], number[]];
  const x1 = a?.[0] ?? -DEFAULT_COORD_SYSTEM_EXTENT_HALF;
  const y1 = a?.[1] ?? -DEFAULT_COORD_SYSTEM_EXTENT_HALF;
  const x2 = b?.[0] ?? DEFAULT_COORD_SYSTEM_EXTENT_HALF;
  const y2 = b?.[1] ?? DEFAULT_COORD_SYSTEM_EXTENT_HALF;
  return {
    width: Math.abs(x2 - x1) || 1,
    height: Math.abs(y2 - y1) || 1,
    cx: (x1 + x2) / 2,
    cy: (y1 + y2) / 2,
  };
}

export function applyPlacement(
  placement: Placement,
  iconCoordSystem: CoordinateSystem | undefined,
  z: number = 0,
): AppliedTransform {
  const extent = placement.extent;
  const px1 = extent[0][0];
  const py1 = extent[0][1];
  const px2 = extent[1][0];
  const py2 = extent[1][1];
  const placementCx = (px1 + px2) / 2;
  const placementCy = (py1 + py2) / 2;

  const icon = coordSystemSize(iconCoordSystem);

  const originX = placement.origin?.[0] ?? 0;
  const originY = placement.origin?.[1] ?? 0;

  const positionX = originX + placementCx;
  const positionY = originY + placementCy;

  const rotationZ = ((placement.rotation ?? 0) * Math.PI) / 180;

  // Signed scale: a negative value encodes a mirror flip (x2 < x1 = horizontal
  // flip, y2 < y1 = vertical flip). The || fallback handles degenerate extents
  // where px2 === px1 / py2 === py1.
  const scaleX = (px2 - px1) / icon.width || 1;
  const scaleY = (py2 - py1) / icon.height || 1;

  return {
    position: { x: positionX, y: positionY, z },
    rotationZ,
    scale: { x: scaleX, y: scaleY, z: 1 },
    meshLocal: { x: icon.cx, y: icon.cy },
    iconSize: { width: icon.width, height: icon.height },
  };
}
