import { Vector3 } from "@babylonjs/core";
import type { Scene, TransformNode } from "@babylonjs/core";
import { CreateLines } from "@babylonjs/core/Meshes/Builders/linesBuilder.js";
import type { Color } from "@dicode/omc-client";

import {
  colorToColor3,
  makeUnlitMaterial,
  makeMeshFromTriangles,
  type OwnedResource,
} from "./shape-utils.js";

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
 * Build one Modelica arrowhead mesh at `tip`, pointing in direction
 * `(dirX, dirY)` (normalised internally). Arrow.None, a zero-length
 * direction, or a non-positive size each return null.
 *
 * Supports `"Filled"` (solid triangle), `"Open"` (hollow V chevron), and
 * `"Half"` (single-sided wing). Unknown values return null.
 */
export function buildArrowhead(
  scene: Scene,
  parent: TransformNode,
  tip: readonly [number, number],
  dirX: number,
  dirY: number,
  size: number,
  kind: string,
  color: Color,
  z: number,
  baseName: string,
): OwnedResource | null {
  if (!kind || kind === "None" || !(size > 0)) return null;
  const len = Math.sqrt(dirX * dirX + dirY * dirY);
  if (!(len > 0)) return null;

  const nx = dirX / len;
  const ny = dirY / len;
  const v = arrowheadVertices(tip, nx, ny, size);

  if (kind === "Filled") {
    const positions = [
      v.tip[0],
      v.tip[1],
      0,
      v.left[0],
      v.left[1],
      0,
      v.right[0],
      v.right[1],
      0,
    ];
    const mesh = makeMeshFromTriangles(scene, baseName, positions, [0, 1, 2]);
    const mat = makeUnlitMaterial(scene, color, `${baseName}.mat`);
    mesh.material = mat;
    mesh.parent = parent;
    mesh.position.set(0, 0, z);
    mesh.isPickable = false;
    return {
      dispose() {
        mesh.dispose();
        mat.dispose();
      },
    };
  }

  if (kind === "Open" || kind === "Half") {
    // Open: left → tip → right (V-chevron); Half: tip → right (§18.6.4 "right side")
    const pts =
      kind === "Open"
        ? [
            new Vector3(v.left[0], v.left[1], z),
            new Vector3(v.tip[0], v.tip[1], z),
            new Vector3(v.right[0], v.right[1], z),
          ]
        : [
            new Vector3(v.tip[0], v.tip[1], z),
            new Vector3(v.right[0], v.right[1], z),
          ];
    const mesh = CreateLines(
      baseName,
      { points: pts, updatable: false },
      scene,
    );
    mesh.color = colorToColor3(color);
    mesh.parent = parent;
    mesh.isPickable = false;
    return {
      dispose() {
        mesh.dispose();
      },
    };
  }

  return null;
}
