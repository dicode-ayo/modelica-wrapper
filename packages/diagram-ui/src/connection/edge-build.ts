import { Color3, Vector3 } from "@babylonjs/core";
import {
  CreateGreasedLine,
  type GreasedLineMaterialBuilderOptions,
} from "@babylonjs/core/Meshes/Builders/greasedLineBuilder.js";
import type { Scene, TransformNode } from "@babylonjs/core";
import type { Point } from "@modelica-wrapper/omc-client";

/**
 * Pure builder for the connection's stroked path. Edges live in the
 * diagram-root local space, at a small negative z so components paint
 * on top.
 *
 * `clocked` toggles a dashed pattern (Modelica synchronous/clocked
 * connection convention).
 */
export interface EdgeOptions {
  points: Point[];
  width?: number;
  color?: Color3;
  clocked?: boolean;
  /** Z offset placed slightly below components (which sit at z = 0). */
  zOffset?: number;
}

export const DEFAULT_EDGE_WIDTH = 1.5;
export const DEFAULT_EDGE_COLOR = new Color3(0.1, 0.1, 0.18);
export const EDGE_Z_OFFSET = -0.01;

export function buildEdge(
  scene: Scene,
  parent: TransformNode | null,
  name: string,
  options: EdgeOptions,
): ReturnType<typeof CreateGreasedLine> | null {
  if (options.points.length < 2) {
    return null;
  }
  const z = options.zOffset ?? EDGE_Z_OFFSET;
  const points = options.points.map(([x, y]) => new Vector3(x, y, z));
  const material: GreasedLineMaterialBuilderOptions = {
    color: options.color ?? DEFAULT_EDGE_COLOR,
    width: options.width ?? DEFAULT_EDGE_WIDTH,
    useColors: false,
    sizeAttenuation: false,
  };
  if (options.clocked) {
    material.useDash = true;
    material.dashCount = Math.max(2, Math.floor(estimatePathLength(points) / 8));
    material.dashRatio = 0.55;
  }
  const mesh = CreateGreasedLine(
    name,
    { points, updatable: false },
    material,
    scene,
  );
  if (parent) {
    mesh.parent = parent;
  }
  return mesh;
}

function estimatePathLength(points: Vector3[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Vector3.Distance(points[i - 1]!, points[i]!);
  }
  return len || 1;
}
