import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import {
  CreateDashedLines,
  CreateLines,
} from "@babylonjs/core/Meshes/Builders/linesBuilder.js";
import type { LinesMesh, Scene, TransformNode } from "@babylonjs/core";
import type { Point } from "@dicode/omc-client";

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
   * Radius of the picking tube around each segment, in diagram units.
   * Doubles as the width of the hover band, so it tracks the waypoint
   * disc radius (`WAYPOINT_RADIUS`) and the two read as one shape.
   */
  hitRadius?: number;
}

export const DEFAULT_EDGE_COLOR = new Color3(0.1, 0.1, 0.18);
export const EDGE_Z_OFFSET = -0.005;

/**
 * Radius of a connection waypoint, in diagram units. Shared by the
 * junction discs and the edge pick tube so the hover band lines up
 * with the discs sitting on it.
 */
export const WAYPOINT_RADIUS = 1.5;
const DEFAULT_HIT_RADIUS = WAYPOINT_RADIUS;

/** Opacity the pick tube renders at while its edge is hovered. */
export const HIT_HOVER_OPACITY = 0.3;
const HIT_HOVER_COLOR = new Color3(0.24, 0.51, 0.96); // blue-500

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
  // `updatable: true` lets `updateEdgePoints` rewrite the vertex
  // buffer in place via the `instance` parameter on subsequent
  // `CreateLines` calls. The cost (a slightly larger GPU buffer
  // allocation) is negligible compared to disposing + recreating the
  // mesh on every pointermove of a component drag.
  const line = options.clocked
    ? CreateDashedLines(
        name,
        {
          points,
          dashNb: DEFAULT_DASH_COUNT,
          dashSize: DEFAULT_DASH_SIZE,
          gapSize: DEFAULT_DASH_GAP,
          updatable: true,
        },
        scene,
      )
    : CreateLines(name, { points, updatable: true }, scene);
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
 * In-place vertex update for the visible LinesMesh. Callers MUST
 * already have verified that the new point count matches the mesh's
 * original — Babylon's `instance` parameter accepts position updates
 * but not topology changes (see the docstrings on `CreateLines` /
 * `CreateDashedLines`). The hit tube is a merged mesh and can't be
 * updated this way; the caller rebuilds it separately if needed.
 */
export function updateEdgePoints(
  scene: Scene,
  line: LinesMesh,
  newPoints: Point[],
  clocked: boolean,
  zOffset: number = EDGE_Z_OFFSET,
): void {
  const points = newPoints.map(([x, y]) => new Vector3(x, y, zOffset));
  if (clocked) {
    CreateDashedLines(
      line.name,
      {
        points,
        dashNb: DEFAULT_DASH_COUNT,
        dashSize: DEFAULT_DASH_SIZE,
        gapSize: DEFAULT_DASH_GAP,
        updatable: true,
        instance: line,
      },
      scene,
    );
  } else {
    CreateLines(line.name, { points, updatable: true, instance: line }, scene);
  }
}

/**
 * Rebuild the picking-hit tube against a new point set. Exported so
 * `OmEdge` can refresh just the hit geometry after an in-place line
 * update — the visible mesh stays alive, only the invisible tube is
 * recycled.
 */
export function rebuildHitTube(
  scene: Scene,
  parent: TransformNode | null,
  name: string,
  newPoints: Point[],
  hitRadius: number = DEFAULT_HIT_RADIUS,
  zOffset: number = EDGE_Z_OFFSET,
): Mesh {
  const points = newPoints.map(([x, y]) => new Vector3(x, y, zOffset));
  const hitArea = buildHitTube(scene, name, points, hitRadius);
  if (parent) {
    hitArea.parent = parent;
  }
  return hitArea;
}

/**
 * Build a single mesh whose volume covers every segment of the
 * polyline. `MeshBuilder.CreateTube` doesn't accept disjoint segments,
 * so we merge per-segment tubes into one mesh. The tube renders at
 * `visibility = 0` (transparent) so it stays pickable — Babylon's
 * default `scene.pick` predicate skips `isVisible = false` meshes but
 * ignores `visibility`. Revealing it (raising `visibility`) doubles as
 * the edge's hover affordance.
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
  const material = new StandardMaterial(`${name}.mat`, scene);
  material.disableLighting = true;
  material.emissiveColor = HIT_HOVER_COLOR;
  merged.material = material;
  merged.visibility = 0;
  merged.isPickable = true;
  return merged;
}
