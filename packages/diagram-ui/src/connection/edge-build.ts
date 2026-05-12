import { Color3, Mesh, MeshBuilder, Vector3 } from "@babylonjs/core";
import {
  CreateDashedLines,
  CreateLines,
} from "@babylonjs/core/Meshes/Builders/linesBuilder.js";
import type { LinesMesh, Scene, TransformNode } from "@babylonjs/core";
import type { Point } from "@modelica-wrapper/omc-client";

/**
 * Pure builder for the connection's stroked path. Edges use Babylon's
 * built-in GL `LinesMesh` (1-pixel `gl.LINES` primitive) for the
 * visible stroke — matches OMEdit's crisp single-pixel look and keeps
 * draw-call cost tiny.
 *
 * Picking gl.LINES is unreliable (the line has zero geometric width),
 * so the builder also returns an invisible "hit area" mesh — a fat
 * tube along each segment — that `scene.pick` can hit. Both meshes
 * share the entity metadata so the picker resolves the same edge
 * either way.
 *
 * `clocked` swaps the visible builder to `CreateDashedLines` for the
 * Modelica synchronous-clock convention.
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
   */
  zOffset?: number;
  /**
   * Radius of the invisible picking tube around each segment, in
   * diagram units. Default 1.5 — easy to click at typical zoom.
   */
  hitRadius?: number;
}

export const DEFAULT_EDGE_COLOR = new Color3(0.1, 0.1, 0.18);
export const EDGE_Z_OFFSET = -0.005;
const DEFAULT_HIT_RADIUS = 1.5;

/** Dash sizing tuned for diagram-coord paths (~10s of units long). */
const DEFAULT_DASH_SIZE = 4;
const DEFAULT_DASH_GAP = 3;
const DEFAULT_DASH_COUNT = 24;

export interface EdgeMeshes {
  /** Visible stroked polyline. Picking it directly is unreliable. */
  line: LinesMesh;
  /** Invisible per-segment tube that the picker actually hits. */
  hitArea: Mesh;
}

export function buildEdge(
  scene: Scene,
  parent: TransformNode | null,
  name: string,
  options: EdgeOptions,
): EdgeMeshes | null {
  if (options.points.length < 2) {
    return null;
  }
  const z = options.zOffset ?? EDGE_Z_OFFSET;
  const points = options.points.map(([x, y]) => new Vector3(x, y, z));
  const line = options.clocked
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
  line.color = options.color ?? DEFAULT_EDGE_COLOR;
  if (parent) {
    line.parent = parent;
  }

  const hitArea = buildHitTube(
    scene,
    `${name}.hit`,
    points,
    options.hitRadius ?? DEFAULT_HIT_RADIUS,
  );
  if (parent) {
    hitArea.parent = parent;
  }
  return { line, hitArea };
}

/**
 * Build a single mesh whose volume covers every segment of the
 * polyline. `MeshBuilder.CreateTube` doesn't accept disjoint segments,
 * so we merge per-segment tubes into one mesh. The result is invisible
 * (`isVisible = false`) but pickable.
 */
function buildHitTube(
  scene: Scene,
  name: string,
  points: Vector3[],
  radius: number,
): Mesh {
  const segments: Mesh[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const seg = MeshBuilder.CreateTube(
      `${name}.${i}`,
      {
        path: [points[i]!, points[i + 1]!],
        radius,
        tessellation: 6,
        cap: 0,
        updatable: false,
      },
      scene,
    );
    segments.push(seg);
  }
  const merged =
    segments.length === 1
      ? segments[0]!
      : (Mesh.MergeMeshes(segments, true, true) ?? segments[0]!);
  merged.name = name;
  merged.isVisible = false;
  merged.isPickable = true;
  return merged;
}

