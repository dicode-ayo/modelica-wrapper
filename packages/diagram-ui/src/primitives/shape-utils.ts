import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Vector3,
  VertexData,
  type Scene,
  type TransformNode,
} from "@babylonjs/core";
import {
  CreateDashedLines,
  CreateLines,
} from "@babylonjs/core/Meshes/Builders/linesBuilder.js";
import type { Color, Extent } from "@modelica-wrapper/omc-client";

/**
 * Shared helpers for the `<om-{rectangle, polygon, line, ellipse, text,
 * bitmap}>` primitive components. Each primitive owns its own mesh
 * lifecycle, but they all hand back this same `OwnedResource` interface
 * so the base class can dispose them uniformly.
 */

export interface OwnedResource {
  dispose(): void;
}

/**
 * Z-step between consecutive shapes in an icon. The camera sits at -Z,
 * so later shapes (higher `zOrder`) paint on top by accumulating a
 * small negative delta.
 */
export const SHAPE_Z_STEP = 0.001;
/** Extra negative-z offset for stroke meshes — keeps the outline on
 *  top of its own fill in case the renderer's depth tie-breaking
 *  flickers. */
export const STROKE_Z_DELTA = 0.0005;
export const DEFAULT_LINE_COLOR: Color = [0, 0, 0];

/** Compute the per-shape z position from a zero-based draw index. */
export function zForOrder(zOrder: number): number {
  return -zOrder * SHAPE_Z_STEP;
}

export interface RectBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function extentToRect(extent: Extent): RectBox {
  const [[x1, y1], [x2, y2]] = extent;
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Drop a trailing duplicate of the first point — Modelica polygons
 *  often close themselves explicitly, but our triangulator and stroke
 *  builders want the open vertex list. */
export function stripClosingDuplicate(
  points: ReadonlyArray<readonly [number, number]>,
): Array<[number, number]> {
  const out: Array<[number, number]> = points.map(([x, y]) => [x, y]);
  if (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (first[0] === last[0] && first[1] === last[1]) {
      out.pop();
    }
  }
  return out;
}

export function colorToColor3(color: Color | undefined): Color3 {
  if (!color || color.length !== 3) {
    return new Color3(0, 0, 0);
  }
  const [r, g, b] = color;
  return new Color3(clampByte(r) / 255, clampByte(g) / 255, clampByte(b) / 255);
}

export function colorToCss(color: Color | undefined, fallback: string): string {
  if (!color || color.length !== 3) return fallback;
  const [r, g, b] = color;
  return `rgb(${clampByte(r)},${clampByte(g)},${clampByte(b)})`;
}

export function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 255) return 255;
  return Math.round(n);
}

/**
 * Unlit material in the icon's fill colour. Filled regions are opaque
 * in Modelica annotations (no alpha), so we don't enable transparency
 * — keeps the pipeline simple and avoids sorting headaches.
 */
export function makeUnlitMaterial(
  scene: Scene,
  color: Color,
  name: string,
): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.disableLighting = true;
  mat.specularColor = new Color3(0, 0, 0);
  mat.emissiveColor = colorToColor3(color);
  mat.backFaceCulling = false;
  return mat;
}

export function makeMeshFromTriangles(
  scene: Scene,
  name: string,
  positions: number[],
  indices: number[],
): Mesh {
  const mesh = new Mesh(name, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  vertexData.normals = normals;
  vertexData.applyToMesh(mesh, false);
  return mesh;
}

export function buildFilledQuad(
  scene: Scene,
  parent: TransformNode,
  cx: number,
  cy: number,
  width: number,
  height: number,
  color: Color,
  z: number,
  baseName: string,
): OwnedResource {
  const plane = MeshBuilder.CreatePlane(
    baseName,
    { width, height, sideOrientation: Mesh.DOUBLESIDE },
    scene,
  );
  const material = makeUnlitMaterial(scene, color, `${baseName}.mat`);
  plane.material = material;
  plane.parent = parent;
  plane.position.set(cx, cy, z);
  plane.isPickable = false;
  return {
    dispose(): void {
      plane.dispose();
      material.dispose();
    },
  };
}

export function buildFanFromCenter(
  scene: Scene,
  parent: TransformNode,
  cx: number,
  cy: number,
  ring: ReadonlyArray<readonly [number, number]>,
  color: Color,
  z: number,
  baseName: string,
): OwnedResource {
  const positions: number[] = [cx, cy, 0];
  for (const [x, y] of ring) {
    positions.push(x - cx, y - cy, 0);
  }
  const indices: number[] = [];
  for (let i = 1; i <= ring.length; i++) {
    const next = i === ring.length ? 1 : i + 1;
    indices.push(0, i, next);
  }
  // The fan's vertex 0 sits at the local origin; positions[1..] are
  // already relative to (cx, cy), and the mesh's position handles the
  // rest. This keeps the bounding box centred on the ellipse origin.
  const localPositions = positions.slice();
  localPositions[0] = 0;
  localPositions[1] = 0;
  const mesh = makeMeshFromTriangles(scene, baseName, localPositions, indices);
  const material = makeUnlitMaterial(scene, color, `${baseName}.mat`);
  mesh.material = material;
  mesh.parent = parent;
  mesh.position.set(cx, cy, z);
  mesh.isPickable = false;
  return {
    dispose(): void {
      mesh.dispose();
      material.dispose();
    },
  };
}

export function buildFilledPolygon(
  scene: Scene,
  parent: TransformNode,
  points: ReadonlyArray<readonly [number, number]>,
  color: Color,
  z: number,
  baseName: string,
): OwnedResource | null {
  const triangles = triangulate(points);
  if (triangles.length === 0) {
    return null;
  }
  const positions: number[] = [];
  for (const [x, y] of points) {
    positions.push(x, y, 0);
  }
  const mesh = makeMeshFromTriangles(scene, baseName, positions, triangles);
  const material = makeUnlitMaterial(scene, color, `${baseName}.mat`);
  mesh.material = material;
  mesh.parent = parent;
  mesh.position.set(0, 0, z);
  mesh.isPickable = false;
  return {
    dispose(): void {
      mesh.dispose();
      material.dispose();
    },
  };
}

// ---------- stroke (polyline) ----------

const DEFAULT_DASH_SIZE = 4;
const DEFAULT_DASH_GAP = 3;

export function buildStroke(
  scene: Scene,
  parent: TransformNode,
  points: ReadonlyArray<readonly [number, number]>,
  color: Color,
  pattern: string | undefined,
  z: number,
  baseName: string,
): OwnedResource | null {
  if (points.length < 2 || pattern === "None") {
    return null;
  }
  const vec = points.map(([x, y]) => new Vector3(x, y, z));
  const colour = colorToColor3(color);

  // GL_LINES is pixel-thin in WebGL, which matches OMEdit's icon look
  // for typical lineThickness ≤ 0.5. Anything thicker isn't visually
  // distinct at default zoom — flagged as a follow-up if we need true
  // thickness later.
  const dash = patternIsDashed(pattern);
  const mesh = dash
    ? CreateDashedLines(
        baseName,
        {
          points: vec,
          dashSize: DEFAULT_DASH_SIZE,
          gapSize: DEFAULT_DASH_GAP,
          dashNb: Math.max(8, points.length * 8),
          updatable: false,
        },
        scene,
      )
    : CreateLines(baseName, { points: vec, updatable: false }, scene);
  mesh.color = colour;
  mesh.parent = parent;
  mesh.isPickable = false;
  return {
    dispose(): void {
      mesh.dispose();
    },
  };
}

function patternIsDashed(pattern: string | undefined): boolean {
  switch (pattern) {
    case "Dash":
    case "Dot":
    case "DashDot":
    case "DashDotDot":
      return true;
    default:
      return false;
  }
}

// ---------- triangulation (ear clipping) ----------

/**
 * Triangulate a simple polygon (no self-intersections, no holes) using
 * the ear-clipping algorithm. Returns triplets of vertex indices into
 * `points`. Works for both convex and concave polygons.
 *
 * Modelica annotation polygons are typically simple — triangles, arrow
 * heads, exclamation marks — so ear-clipping is fast enough. The
 * pathological case (~thousands of vertices) doesn't occur in real
 * icons.
 */
export function triangulate(
  points: ReadonlyArray<readonly [number, number]>,
): number[] {
  const n = points.length;
  if (n < 3) {
    return [];
  }
  const area = signedArea(points);
  const indices: number[] = [];
  if (area >= 0) {
    for (let i = 0; i < n; i++) indices.push(i);
  } else {
    for (let i = n - 1; i >= 0; i--) indices.push(i);
  }

  const triangles: number[] = [];
  let guard = indices.length * indices.length;
  while (indices.length > 3 && guard-- > 0) {
    let earFound = false;
    for (let i = 0; i < indices.length; i++) {
      const prev = indices[(i - 1 + indices.length) % indices.length]!;
      const curr = indices[i]!;
      const next = indices[(i + 1) % indices.length]!;
      if (isEar(points, indices, prev, curr, next)) {
        triangles.push(prev, curr, next);
        indices.splice(i, 1);
        earFound = true;
        break;
      }
    }
    if (!earFound) {
      return [];
    }
  }
  if (indices.length === 3) {
    triangles.push(indices[0]!, indices[1]!, indices[2]!);
  }
  return triangles;
}

function signedArea(points: ReadonlyArray<readonly [number, number]>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function isEar(
  points: ReadonlyArray<readonly [number, number]>,
  indices: ReadonlyArray<number>,
  prev: number,
  curr: number,
  next: number,
): boolean {
  const ax = points[prev]![0];
  const ay = points[prev]![1];
  const bx = points[curr]![0];
  const by = points[curr]![1];
  const cx = points[next]![0];
  const cy = points[next]![1];
  const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (cross <= 0) {
    return false;
  }
  for (const idx of indices) {
    if (idx === prev || idx === curr || idx === next) {
      continue;
    }
    const [px, py] = points[idx]!;
    if (pointInTriangle(px, py, ax, ay, bx, by, cx, cy)) {
      return false;
    }
  }
  return true;
}

function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function sign(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by);
}
