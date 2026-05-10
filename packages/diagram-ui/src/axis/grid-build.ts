import { Color3, Vector3 } from "@babylonjs/core";
import {
  CreateGreasedLine,
  type GreasedLineMaterialBuilderOptions,
} from "@babylonjs/core/Meshes/Builders/greasedLineBuilder.js";
import type { Scene, TransformNode } from "@babylonjs/core";

/**
 * Pure constructor for the grid + axis meshes. Separated from the
 * `<om-grid-axis>` element so the same routine drives tests, stories
 * and the runtime element.
 *
 * The grid lives in the diagram plane (z = 0) and extends from
 * `-extent` to `+extent` on both axes. Minor lines every `minorStep`,
 * major lines every `majorStep`, plus a distinct X- and Y-axis pair.
 */
export interface GridOptions {
  extent: number;
  minorStep: number;
  majorStep: number;
  minorColor?: Color3 | undefined;
  majorColor?: Color3 | undefined;
  axisColor?: Color3 | undefined;
  /** Optional width in screen pixels for the major / axis lines. */
  width?: number | undefined;
}

export const DEFAULT_GRID_OPTIONS: GridOptions = {
  extent: 1000,
  minorStep: 10,
  majorStep: 100,
  minorColor: new Color3(0.84, 0.84, 0.86),
  majorColor: new Color3(0.62, 0.62, 0.66),
  axisColor: new Color3(0.27, 0.27, 0.43),
  width: 1,
};

export interface GridMeshes {
  root: TransformNode;
  minor: ReturnType<typeof CreateGreasedLine>;
  major: ReturnType<typeof CreateGreasedLine>;
  axes: ReturnType<typeof CreateGreasedLine>;
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
    const isMajor = Math.abs(v) % majorStep < 1e-9;
    if (Math.abs(v) < 1e-9) {
      continue; // axes drawn separately
    }
    const targetX = isMajor ? major : minor;
    const targetY = isMajor ? major : minor;
    targetX.push([new Vector3(-extent, v, 0), new Vector3(extent, v, 0)]);
    targetY.push([new Vector3(v, -extent, 0), new Vector3(v, extent, 0)]);
  }

  const axes: Vector3[][] = [
    [new Vector3(-extent, 0, 0), new Vector3(extent, 0, 0)],
    [new Vector3(0, -extent, 0), new Vector3(0, extent, 0)],
  ];

  const root = parent;
  const width = options.width ?? 1;
  const minorMesh = CreateGreasedLine(
    "om-grid-minor",
    { points: minor, updatable: false },
    matOpts(options.minorColor ?? DEFAULT_GRID_OPTIONS.minorColor!, width * 0.5),
    scene,
  );
  const majorMesh = CreateGreasedLine(
    "om-grid-major",
    { points: major, updatable: false },
    matOpts(options.majorColor ?? DEFAULT_GRID_OPTIONS.majorColor!, width),
    scene,
  );
  const axesMesh = CreateGreasedLine(
    "om-grid-axes",
    { points: axes, updatable: false },
    matOpts(options.axisColor ?? DEFAULT_GRID_OPTIONS.axisColor!, width * 1.5),
    scene,
  );

  minorMesh.parent = root;
  majorMesh.parent = root;
  axesMesh.parent = root;

  return { root, minor: minorMesh, major: majorMesh, axes: axesMesh };
}

function matOpts(
  color: Color3,
  width: number,
): GreasedLineMaterialBuilderOptions {
  return {
    color,
    width,
    useColors: false,
    sizeAttenuation: false,
  };
}
