import {
  Color3,
  CreateGreasedLine,
  Mesh,
  MeshBuilder,
  Vector3,
} from "@babylonjs/core";
import type {
  GreasedLineBaseMesh,
  Scene,
  TransformNode,
} from "@babylonjs/core";
import type { Point } from "@dicode/omc-client";

import { sceneWorldPerPixel } from "../scene/camera-metrics.js";
import { polylineLength, screenDashCount } from "../scene/line-metrics.js";

/**
 * Pure builder for the connection's stroked path. Edges are
 * `GreasedLine` ribbons with a constant screen-space width
 * (`sizeAttenuation: true`), antialiased and crisp at any zoom.
 *
 * Picking the thin ribbon is unreliable, so the builder also returns an
 * invisible "hit area" mesh — a fat tube along each segment — that
 * `scene.pick` can hit. Both meshes share the entity metadata so the
 * picker resolves the same edge either way.
 *
 * `clocked` turns on the GreasedLine material's dash mode for the
 * Modelica synchronous-clock convention; the dash count is held
 * constant in screen space (see {@link updateEdgeDashes}).
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

/** On-screen edge ribbon width, in device pixels. */
const EDGE_WIDTH_PX = 1.5;

/** On-screen length of one dash+gap cycle for clocked edges, in pixels. */
const DASH_PERIOD_PX = 10;
/** Fraction of each dash cycle left empty (GreasedLine `dashRatio`). */
const DASH_RATIO = 0.4;

export interface EdgeMeshes {
  /** Visible stroked polyline. Picking it directly is unreliable. */
  line: GreasedLineBaseMesh;
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
  const line = CreateGreasedLine(
    name,
    { points, updatable: true },
    {
      width: EDGE_WIDTH_PX,
      sizeAttenuation: true,
      color: options.color ?? DEFAULT_EDGE_COLOR,
      ...(options.clocked ? { useDash: true, dashRatio: DASH_RATIO } : {}),
    },
    scene,
  );
  if (parent) {
    line.parent = parent;
  }
  if (options.clocked) {
    updateEdgeDashes(scene, line, options.points);
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

/** Recolour an edge's ribbon in place via its GreasedLine material. */
export function setEdgeColor(line: GreasedLineBaseMesh, color: Color3): void {
  line.greasedLineMaterial?.setColor(color);
}

/**
 * In-place vertex update for the visible ribbon via GreasedLine's
 * `setPoints`. Unlike the old `gl.LINES` path this accepts any point
 * count, but callers still gate on an unchanged count so the merged hit
 * tube and the ribbon stay in sync. Re-derives the screen-space dash
 * count for clocked edges.
 */
export function updateEdgePoints(
  scene: Scene,
  line: GreasedLineBaseMesh,
  newPoints: Point[],
  clocked: boolean,
  zOffset: number = EDGE_Z_OFFSET,
): void {
  const points = newPoints.map(([x, y]) => new Vector3(x, y, zOffset));
  line.setPoints(points);
  if (clocked) {
    updateEdgeDashes(scene, line, newPoints);
  }
}

/**
 * Set a clocked edge's `dashCount` so one dash+gap cycle spans a
 * constant {@link DASH_PERIOD_PX} device pixels regardless of zoom.
 * Safe to call on any edge; a no-op when the material isn't dashed.
 */
export function updateEdgeDashes(
  scene: Scene,
  line: GreasedLineBaseMesh,
  points: ReadonlyArray<readonly [number, number]>,
): void {
  const material = line.greasedLineMaterial;
  if (!material || !material.useDash) {
    return;
  }
  const wpp = sceneWorldPerPixel(scene) ?? 1;
  material.dashCount = screenDashCount(
    polylineLength(points),
    wpp,
    DASH_PERIOD_PX,
  );
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
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) {
      continue;
    }
    const seg = MeshBuilder.CreateTube(
      `${name}.${i}`,
      {
        path: [a, b],
        radius,
        tessellation: 6,
        cap: 0,
        updatable: false,
      },
      scene,
    );
    segments.push(seg);
  }
  const first = segments[0];
  // An empty placeholder when every segment was skipped, so callers always
  // get a disposable mesh and never have to null-check the hit area.
  const merged =
    segments.length === 1 || first === undefined
      ? (first ?? new Mesh(name, scene))
      : (Mesh.MergeMeshes(segments, true, true) ?? first);
  merged.name = name;
  merged.isVisible = false;
  merged.isPickable = true;
  return merged;
}
