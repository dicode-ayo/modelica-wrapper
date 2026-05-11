import { Color3, Vector3 } from "@babylonjs/core";
import { CreateLineSystem } from "@babylonjs/core/Meshes/Builders/linesBuilder.js";
import type { LinesMesh, Scene, TransformNode } from "@babylonjs/core";

/**
 * Pure constructor for the grid + axis meshes. Separated from the
 * `<om-grid-axis>` element so the same routine drives tests, stories
 * and the runtime element.
 *
 * Uses Babylon's `CreateLineSystem` (a `LinesMesh` backed by
 * `gl.LINES`) rather than GreasedLine — grid lines are decorative and
 * pixel-thin, so the ribbon-based GreasedLine would only add geometry
 * for no visible gain. One LinesMesh per "layer" (minor / major / axes)
 * keeps each colour separate without per-vertex colour arrays.
 *
 * The grid lives at a small negative z (`GRID_Z`) so it paints behind
 * every entity layer:
 *
 *     grid          z = GRID_Z          (-0.05)
 *     components    z =  0              (default OmShapeNode placement)
 *     edges         z = EDGE_Z_OFFSET   (+0.005)
 *     connectors    z = ~ +0.005 too    (zOffset hook from OmConnector)
 *     labels        z slightly higher
 */
export interface GridOptions {
  extent: number;
  minorStep: number;
  majorStep: number;
  minorColor?: Color3 | undefined;
  majorColor?: Color3 | undefined;
  axisColor?: Color3 | undefined;
}

export const DEFAULT_GRID_OPTIONS: GridOptions = {
  extent: 1000,
  minorStep: 10,
  majorStep: 100,
  minorColor: new Color3(0.84, 0.84, 0.86),
  majorColor: new Color3(0.62, 0.62, 0.66),
  axisColor: new Color3(0.27, 0.27, 0.43),
};

export const GRID_Z = -0.05;

export interface GridMeshes {
  root: TransformNode;
  minor: LinesMesh;
  major: LinesMesh;
  axes: LinesMesh;
}

/** Builds the grid + axes under a TransformNode and returns the handles. */
export function buildGrid(
  scene: Scene,
  parent: TransformNode,
  options: GridOptions = DEFAULT_GRID_OPTIONS,
): GridMeshes {
  const { extent, minorStep, majorStep } = options;
  const minor: Vector3[][] = [];
  const major: Vector3[][] = [];
  for (let v = -extent; v <= extent; v += minorStep) {
    if (Math.abs(v) < 1e-9) {
      continue; // axes drawn separately
    }
    const isMajor = Math.abs(v) % majorStep < 1e-9;
    const target = isMajor ? major : minor;
    target.push([new Vector3(-extent, v, GRID_Z), new Vector3(extent, v, GRID_Z)]);
    target.push([new Vector3(v, -extent, GRID_Z), new Vector3(v, extent, GRID_Z)]);
  }

  const axes: Vector3[][] = [
    [new Vector3(-extent, 0, GRID_Z), new Vector3(extent, 0, GRID_Z)],
    [new Vector3(0, -extent, GRID_Z), new Vector3(0, extent, GRID_Z)],
  ];

  const minorMesh = CreateLineSystem(
    "om-grid-minor",
    { lines: minor, updatable: false },
    scene,
  );
  const majorMesh = CreateLineSystem(
    "om-grid-major",
    { lines: major, updatable: false },
    scene,
  );
  const axesMesh = CreateLineSystem(
    "om-grid-axes",
    { lines: axes, updatable: false },
    scene,
  );

  minorMesh.color = options.minorColor ?? DEFAULT_GRID_OPTIONS.minorColor!;
  majorMesh.color = options.majorColor ?? DEFAULT_GRID_OPTIONS.majorColor!;
  axesMesh.color = options.axisColor ?? DEFAULT_GRID_OPTIONS.axisColor!;

  for (const m of [minorMesh, majorMesh, axesMesh]) {
    m.parent = parent;
    // The grid is decorative — don't let it eat picks meant for entities.
    m.isPickable = false;
  }

  return { root: parent, minor: minorMesh, major: majorMesh, axes: axesMesh };
}
