import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { CreateLineSystem } from "@babylonjs/core/Meshes/Builders/linesBuilder.js";
import type { LinesMesh, Scene, TransformNode } from "@babylonjs/core";

/**
 * Pure constructor for the grid, axes, and optional extent rectangle.
 * Separated from the `<om-grid-axis>` element so the same routine
 * drives tests, stories and the runtime element.
 *
 * Uses Babylon's `CreateLineSystem` (a `LinesMesh` backed by
 * `gl.LINES`) rather than GreasedLine — grid lines are decorative and
 * pixel-thin, so the ribbon-based GreasedLine would only add geometry
 * for no visible gain. One LinesMesh per "layer" (minor / major /
 * axes) keeps each colour separate without per-vertex colour arrays.
 *
 * The extent rectangle is OMEdit's "drawing area": a filled plane the
 * size of the host class's `coordinateSystem.extent`, painted in
 * white so the modeller sees where the canonical icon box lives
 * against the gray scene background. The plane is opt-in via
 * `options.extentRect`.
 *
 * Z-axis layering (camera sits at -Z, so larger z = farther from
 * camera = drawn behind):
 *
 *     extent-rect   z = EXTENT_RECT_Z   (+0.10, farthest)
 *     grid          z = GRID_Z          (+0.05, behind entities)
 *     components    z =  0              (default OmShapeNode placement)
 *     edges         z = EDGE_Z_OFFSET   (-0.005, in front of components)
 *     connectors    z = ~ -0.005 too    (zOffset hook from OmConnector)
 *     labels        z slightly lower (closer to camera)
 */
export interface GridOptions {
  /** Half-extent of the grid lines, in diagram units. */
  extent: number;
  /** Spacing between minor lines on the X axis. */
  minorStep: number;
  /** Spacing between minor lines on the Y axis (defaults to `minorStep`). */
  minorStepY?: number | undefined;
  /** Spacing between major lines on the X axis. */
  majorStep: number;
  /** Spacing between major lines on the Y axis (defaults to `majorStep`). */
  majorStepY?: number | undefined;
  minorColor?: Color3 | undefined;
  majorColor?: Color3 | undefined;
  axisColor?: Color3 | undefined;
  /**
   * Optional filled rectangle representing the host class's coordinate
   * system extent — OMEdit's white "drawing area". Coords are in
   * diagram units. The rectangle is rendered behind the grid lines.
   */
  extentRect?:
    | {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        /** Fill colour of the rectangle interior. Defaults to white. */
        color?: Color3 | undefined;
        /**
         * Stroke colour for the visible border around the rectangle.
         * Defaults to a medium slate; set to `null` to suppress the
         * border (leaving only the fill).
         */
        borderColor?: Color3 | null | undefined;
      }
    | undefined;
}

export const DEFAULT_GRID_OPTIONS: GridOptions = {
  extent: 1000,
  // OMEdit's `grid = (2, 2)` is a SNAP step, not a draw step — the
  // visible grid is far coarser than the snap unit. We mirror that:
  // metadata grid → rendered minor step is `metadata × 10` (so the
  // common default of 2 produces a 20-unit minor grid). Major lines
  // fall every 5 minors (every 100 units by default, ≈ the boundary
  // of the canonical [-100,100] extent).
  minorStep: 20,
  majorStep: 100,
  minorColor: new Color3(0.92, 0.92, 0.94),
  majorColor: new Color3(0.78, 0.78, 0.82),
  axisColor: new Color3(0.55, 0.55, 0.62),
};

export const GRID_Z = 0.05;
export const EXTENT_RECT_Z = 0.1;
// Border lines paint slightly in front of the fill (camera at -Z means
// smaller z is closer) so they don't get z-fought by the fill plane.
export const EXTENT_BORDER_Z = 0.099;

const DEFAULT_EXTENT_RECT_COLOR = new Color3(1, 1, 1);
const DEFAULT_EXTENT_BORDER_COLOR = new Color3(0.45, 0.45, 0.55);

export interface GridMeshes {
  root: TransformNode;
  minor: LinesMesh;
  major: LinesMesh;
  axes: LinesMesh;
  /** Present only when `options.extentRect` is set. */
  extentRect?: Mesh;
  /** Present only when `options.extentRect` is set. */
  extentRectMaterial?: StandardMaterial;
  /** Border outline. Present only when the extent rect is built AND `borderColor !== null`. */
  extentBorder?: LinesMesh;
}

/** Builds the grid + axes (+ optional extent rect) and returns the handles. */
export function buildGrid(
  scene: Scene,
  parent: TransformNode,
  options: GridOptions = DEFAULT_GRID_OPTIONS,
): GridMeshes {
  const { extent } = options;
  const minorX = options.minorStep;
  const minorY = options.minorStepY ?? options.minorStep;
  const majorX = options.majorStep;
  const majorY = options.majorStepY ?? options.majorStep;

  const minor: Vector3[][] = [];
  const major: Vector3[][] = [];
  // Vertical lines (constant x): stepped by X grid spacing.
  for (let v = -extent; v <= extent; v += minorX) {
    if (Math.abs(v) < 1e-9) {
      continue; // axes drawn separately
    }
    const isMajor = Math.abs(v) % majorX < 1e-9;
    const target = isMajor ? major : minor;
    target.push([new Vector3(v, -extent, GRID_Z), new Vector3(v, extent, GRID_Z)]);
  }
  // Horizontal lines (constant y): stepped by Y grid spacing.
  for (let v = -extent; v <= extent; v += minorY) {
    if (Math.abs(v) < 1e-9) {
      continue;
    }
    const isMajor = Math.abs(v) % majorY < 1e-9;
    const target = isMajor ? major : minor;
    target.push([new Vector3(-extent, v, GRID_Z), new Vector3(extent, v, GRID_Z)]);
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

  const result: GridMeshes = {
    root: parent,
    minor: minorMesh,
    major: majorMesh,
    axes: axesMesh,
  };

  if (options.extentRect) {
    const built = buildExtentRect(scene, parent, options.extentRect);
    result.extentRect = built.extentRect;
    result.extentRectMaterial = built.extentRectMaterial;
    if (built.extentBorder) {
      result.extentBorder = built.extentBorder;
    }
  }

  return result;
}

function buildExtentRect(
  scene: Scene,
  parent: TransformNode,
  rect: NonNullable<GridOptions["extentRect"]>,
): {
  extentRect: Mesh;
  extentRectMaterial: StandardMaterial;
  extentBorder?: LinesMesh;
} {
  const minX = Math.min(rect.x1, rect.x2);
  const maxX = Math.max(rect.x1, rect.x2);
  const minY = Math.min(rect.y1, rect.y2);
  const maxY = Math.max(rect.y1, rect.y2);
  const width = Math.max(1e-6, maxX - minX);
  const height = Math.max(1e-6, maxY - minY);

  const material = new StandardMaterial("om-grid-extent-mat", scene);
  material.disableLighting = true;
  material.specularColor = new Color3(0, 0, 0);
  material.emissiveColor = rect.color ?? DEFAULT_EXTENT_RECT_COLOR;
  material.backFaceCulling = false;

  const mesh = MeshBuilder.CreatePlane(
    "om-grid-extent-rect",
    { width, height, sideOrientation: Mesh.DOUBLESIDE },
    scene,
  );
  mesh.material = material;
  mesh.parent = parent;
  mesh.position.set((minX + maxX) / 2, (minY + maxY) / 2, EXTENT_RECT_Z);
  mesh.isPickable = false;

  // `null` explicitly opts out of the border. `undefined` keeps the
  // default; any Color3 sets a custom stroke.
  if (rect.borderColor === null) {
    return { extentRect: mesh, extentRectMaterial: material };
  }
  const borderColor = rect.borderColor ?? DEFAULT_EXTENT_BORDER_COLOR;
  const border = CreateLineSystem(
    "om-grid-extent-border",
    {
      lines: [
        [
          new Vector3(minX, minY, EXTENT_BORDER_Z),
          new Vector3(maxX, minY, EXTENT_BORDER_Z),
          new Vector3(maxX, maxY, EXTENT_BORDER_Z),
          new Vector3(minX, maxY, EXTENT_BORDER_Z),
          new Vector3(minX, minY, EXTENT_BORDER_Z),
        ],
      ],
      updatable: false,
    },
    scene,
  );
  border.color = borderColor;
  border.parent = parent;
  border.isPickable = false;
  return { extentRect: mesh, extentRectMaterial: material, extentBorder: border };
}
