import { Color3, Vector3 } from "@babylonjs/core";
import {
  CreateDashedLines,
  CreateLines,
} from "@babylonjs/core/Meshes/Builders/linesBuilder.js";
import type { LinesMesh, Scene, TransformNode } from "@babylonjs/core";
import type { Point } from "@modelica-wrapper/omc-client";

/**
 * Pure builder for the connection's stroked path. Edges use Babylon's
 * built-in GL `LinesMesh` (1-pixel `gl.LINES` primitive) rather than
 * the ribbon-based GreasedLine — that matches OMEdit's crisp single-
 * pixel connection look and keeps draw-call cost tiny.
 *
 * `clocked` swaps the builder to `CreateDashedLines` for the Modelica
 * synchronous-clock convention.
 */
export interface EdgeOptions {
  points: Point[];
  color?: Color3;
  clocked?: boolean;
  /**
   * Z offset placing the line in front of components (which sit at
   * z = 0) so the routed wire is visible even when it crosses an
   * intermediate component. The camera sits at -Z, so "closer to
   * camera" means *negative* z — hence the negative default.
   * Matches OMEdit's drawing order.
   */
  zOffset?: number;
}

export const DEFAULT_EDGE_COLOR = new Color3(0.1, 0.1, 0.18);
export const EDGE_Z_OFFSET = -0.005;

/** Dash sizing tuned for diagram-coord paths (~10s of units long). */
const DEFAULT_DASH_SIZE = 4;
const DEFAULT_DASH_GAP = 3;
const DEFAULT_DASH_COUNT = 24;

export function buildEdge(
  scene: Scene,
  parent: TransformNode | null,
  name: string,
  options: EdgeOptions,
): LinesMesh | null {
  if (options.points.length < 2) {
    return null;
  }
  const z = options.zOffset ?? EDGE_Z_OFFSET;
  const points = options.points.map(([x, y]) => new Vector3(x, y, z));
  const mesh = options.clocked
    ? CreateDashedLines(
        name,
        {
          points,
          dashNb: DEFAULT_DASH_COUNT,
          dashSize: DEFAULT_DASH_SIZE,
          gapSize: DEFAULT_DASH_GAP,
          updatable: false,
        },
        scene,
      )
    : CreateLines(name, { points, updatable: false }, scene);
  mesh.color = options.color ?? DEFAULT_EDGE_COLOR;
  if (parent) {
    mesh.parent = parent;
  }
  return mesh;
}
