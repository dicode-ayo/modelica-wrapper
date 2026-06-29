import {
  Color3,
  CreateGreasedLine,
  Mesh,
  StandardMaterial,
  TransformNode as TransformNodeImpl,
  Vector3,
  VertexData,
  type Scene,
  type TransformNode,
} from "@babylonjs/core";
import type { Color, Extent, Point } from "@dicode/omc-client";
import type { FillSpec } from "@dicode/diagram-svg";

import { resolveFillTexture } from "./fill-texture.js";

/** Per-shape GraphicItem transform fields (§18.6) every primitive carries. */
export interface GraphicItemTransform {
  origin?: [number, number] | undefined;
  rotation?: number | undefined;
}

/**
 * Return the node a shape's meshes should be parented to, honouring the
 * shape's own `origin` / `rotation` (issue #76, item 15). When both are
 * default, `parent` is returned unchanged (no extra node). Otherwise a child
 * `TransformNode` is created at `origin`, rotated `rotation` degrees CCW about
 * Z (Modelica convention), and returned; the caller pushes its `dispose` onto
 * `resources` so it tears down with the shape's meshes.
 *
 * The returned `dispose` only disposes the wrapper node when one was created
 * (the parent is never disposed here).
 */
export function graphicItemNode(
  parent: TransformNode,
  shape: GraphicItemTransform,
  name: string,
): { node: TransformNode; dispose: () => void } {
  const ox = shape.origin?.[0] ?? 0;
  const oy = shape.origin?.[1] ?? 0;
  const rot = shape.rotation ?? 0;
  if (ox === 0 && oy === 0 && rot === 0) {
    return { node: parent, dispose: () => {} };
  }
  const node = new TransformNodeImpl(name, parent.getScene());
  node.parent = parent;
  node.position = new Vector3(ox, oy, 0);
  // Modelica rotation is CCW-positive about +Z; Babylon's rotation.z is the
  // same axis convention, so degrees → radians directly.
  node.rotation = new Vector3(0, 0, (rot * Math.PI) / 180);
  return { node, dispose: () => node.dispose() };
}

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

/** Axis-aligned bounding extent of a point list (a poly's entity frame). */
export function pointsExtent(points: Point[]): Extent {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
}

export function extentToRect(extent: Extent): RectBox {
  const [[x1, y1], [x2, y2]] = extent;
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Modelica `Rectangle.radius` is the corner radius in diagram units,
 * clamped to half the shorter side so opposite corners never overlap
 * (matches OMEdit). A non-positive or missing radius yields `0`.
 */
export function clampCornerRadius(
  radius: number | undefined,
  width: number,
  height: number,
): number {
  if (radius === undefined || !(radius > 0)) return 0;
  return Math.min(radius, width / 2, height / 2);
}

/** Quarter-circle segment count per rounded corner, capped so the ring
 *  stays within the triangulator's budget: 4*(8+1)+1 = 37 verts/shape. */
const CORNER_SEGMENTS = 8;

/**
 * Closed CCW vertex ring for a rectangle whose corners are rounded by
 * `radius` (already clamped via {@link clampCornerRadius}). The box spans
 * `[x, x+width] × [y, y+height]`; each corner is a quarter-circle of
 * `CORNER_SEGMENTS` segments. A zero radius returns the four sharp corners.
 * The first vertex is repeated as the last so stroke builders draw a closed
 * outline.
 */
export function roundedRectRing(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): Array<[number, number]> {
  if (!(radius > 0)) {
    return [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
      [x, y],
    ];
  }
  const r = radius;
  const cx0 = x + r;
  const cx1 = x + width - r;
  const cy0 = y + r;
  const cy1 = y + height - r;
  // Corner centres + arc start angle (CCW), in draw order: bottom-right,
  // top-right, top-left, bottom-left.
  const corners: ReadonlyArray<readonly [number, number, number]> = [
    [cx1, cy0, -Math.PI / 2],
    [cx1, cy1, 0],
    [cx0, cy1, Math.PI / 2],
    [cx0, cy0, Math.PI],
  ];
  const ring: Array<[number, number]> = [];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= CORNER_SEGMENTS; i++) {
      const a = start + (Math.PI / 2) * (i / CORNER_SEGMENTS);
      ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  const first = ring[0];
  if (first) ring.push([first[0], first[1]]);
  return ring;
}

/** Drop a trailing duplicate of the first point — Modelica polygons
 *  often close themselves explicitly, but our triangulator and stroke
 *  builders want the open vertex list. */
export function stripClosingDuplicate(
  points: ReadonlyArray<readonly [number, number]>,
): Array<[number, number]> {
  const out: Array<[number, number]> = points.map(([x, y]) => [x, y]);
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first && last && first[0] === last[0] && first[1] === last[1]) {
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

/**
 * Material for a gradient / hatch fill spec. Bakes (and caches) the spec to a
 * `DynamicTexture` and maps it as the emissive texture; falls back to a flat
 * `makeUnlitMaterial` in the spec's representative color when the bake is
 * unavailable (e.g. `NullEngine` with no canvas 2D context) or the spec is
 * solid.
 */
export function makeFillMaterial(
  scene: Scene,
  spec: FillSpec,
  aspect: number,
  name: string,
): StandardMaterial {
  const flat = makeUnlitMaterial(scene, fillSpecBaseColor(spec), name);
  const texture = resolveFillTexture(scene, spec, aspect);
  if (texture) {
    flat.emissiveColor = new Color3(1, 1, 1);
    flat.emissiveTexture = texture;
    flat.diffuseTexture = texture;
  }
  return flat;
}

/** The flat colour a fill spec degrades to without its texture. */
function fillSpecBaseColor(spec: FillSpec): Color {
  switch (spec.kind) {
    case "solid":
      return spec.color;
    case "hatch":
      return spec.background;
    case "linear-gradient":
    case "radial-gradient": {
      const mid = spec.stops.find((s) => s.offset > 0 && s.offset < 1);
      return mid?.color ?? spec.stops[0]?.color ?? DEFAULT_LINE_COLOR;
    }
    case "none":
      return DEFAULT_LINE_COLOR;
  }
}

export function makeMeshFromTriangles(
  scene: Scene,
  name: string,
  positions: number[],
  indices: number[],
  uvs?: number[],
): Mesh {
  const mesh = new Mesh(name, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  if (uvs) {
    vertexData.uvs = uvs;
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  vertexData.normals = normals;
  vertexData.applyToMesh(mesh, false);
  return mesh;
}

/**
 * Map an icon-space point to a UV for the fill texture. Gradients (CLAMP) map
 * the bbox to `0..1`; hatches (WRAP) map in tile-spacing units so the small
 * tile repeats at a fixed icon-unit density independent of the shape size.
 */
function fillUv(
  px: number,
  py: number,
  box: RectBox,
  spec: FillSpec,
): [number, number] {
  if (spec.kind === "hatch") {
    return [(px - box.x) / spec.spacing, (py - box.y) / spec.spacing];
  }
  const u = box.width > 0 ? (px - box.x) / box.width : 0;
  const v = box.height > 0 ? (py - box.y) / box.height : 0;
  return [u, v];
}

export function buildFilledQuad(
  scene: Scene,
  parent: TransformNode,
  box: RectBox,
  spec: FillSpec,
  z: number,
  baseName: string,
): OwnedResource {
  const { x, y, width, height } = box;
  const corners: Array<[number, number]> = [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const [px, py] of corners) {
    positions.push(px, py, 0);
    const [u, v] = fillUv(px, py, box, spec);
    uvs.push(u, v);
  }
  const indices = [0, 1, 2, 0, 2, 3];
  const mesh = makeMeshFromTriangles(scene, baseName, positions, indices, uvs);
  const aspect = height > 0 ? width / height : 1;
  const material = makeFillMaterial(scene, spec, aspect, `${baseName}.mat`);
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

export function buildFanFromCenter(
  scene: Scene,
  parent: TransformNode,
  cx: number,
  cy: number,
  ring: ReadonlyArray<readonly [number, number]>,
  box: RectBox,
  spec: FillSpec,
  z: number,
  baseName: string,
): OwnedResource {
  // Vertex 0 is the centre at the mesh's local origin; ring vertices are
  // relative to (cx, cy) so the bounding box stays centred on the ellipse,
  // with the mesh position carrying (cx, cy). UVs derive from absolute
  // icon-space coords so the fill texture maps over the shape's bbox.
  const localPositions: number[] = [0, 0, 0];
  const uvs: number[] = [];
  const [cu, cv] = fillUv(cx, cy, box, spec);
  uvs.push(cu, cv);
  for (const [x, y] of ring) {
    localPositions.push(x - cx, y - cy, 0);
    const [u, v] = fillUv(x, y, box, spec);
    uvs.push(u, v);
  }
  const indices: number[] = [];
  for (let i = 1; i <= ring.length; i++) {
    const next = i === ring.length ? 1 : i + 1;
    indices.push(0, i, next);
  }
  const mesh = makeMeshFromTriangles(
    scene,
    baseName,
    localPositions,
    indices,
    uvs,
  );
  const aspect = box.height > 0 ? box.width / box.height : 1;
  const material = makeFillMaterial(scene, spec, aspect, `${baseName}.mat`);
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
  spec: FillSpec,
  z: number,
  baseName: string,
): OwnedResource | null {
  const triangles = triangulate(points);
  if (triangles.length === 0) {
    return null;
  }
  const box = pointsBox(points);
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const [x, y] of points) {
    positions.push(x, y, 0);
    const [u, v] = fillUv(x, y, box, spec);
    uvs.push(u, v);
  }
  const mesh = makeMeshFromTriangles(
    scene,
    baseName,
    positions,
    triangles,
    uvs,
  );
  const aspect = box.height > 0 ? box.width / box.height : 1;
  const material = makeFillMaterial(scene, spec, aspect, `${baseName}.mat`);
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

/** Axis-aligned bounding box of a point list, for UV derivation. */
function pointsBox(points: ReadonlyArray<readonly [number, number]>): RectBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ---------- stroke (polyline) ----------

/** Modelica default stroke thickness (mm). */
const DEFAULT_STROKE_THICKNESS = 0.25;
/** On-screen px for a default-thickness line when the host provides no
 *  `lineThicknessScale`. The host control overrides it. */
const STROKE_WIDTH_SCALE = 2;
/** Screen-px anti-vanish floor — kept low so the host's lineThicknessScale
 *  control stays live for default-thickness lines (else they all clamp here). */
const MIN_STROKE_WIDTH = 1;

/**
 * On-screen stroke width (px) for a Modelica `thickness`, normalized to the
 * default thickness so `scale` ≈ px for a default line and an explicit
 * `thickness` multiplies up from there; floored so it never vanishes.
 */
export function strokeWidthFor(
  thickness: number | undefined,
  scale: number | undefined,
): number {
  const thicknessRatio =
    (thickness ?? DEFAULT_STROKE_THICKNESS) / DEFAULT_STROKE_THICKNESS;
  return Math.max(
    thicknessRatio * (scale ?? STROKE_WIDTH_SCALE),
    MIN_STROKE_WIDTH,
  );
}

export function buildStroke(
  scene: Scene,
  parent: TransformNode,
  points: ReadonlyArray<readonly [number, number]>,
  color: Color,
  pattern: string | undefined,
  z: number,
  baseName: string,
  thickness?: number,
  scale?: number,
): OwnedResource | null {
  const first = points[0];
  if (points.length < 2 || pattern === "None" || first === undefined) {
    return null;
  }
  // All-coincident points build a degenerate (invisible) line — skip it.
  if (!points.some(([x, y]) => x !== first[0] || y !== first[1])) {
    return null;
  }

  // One GreasedLine config for EVERY stroke and the selection outline:
  // default material (StandardMaterial + GreasedLine plugin) + screen-relative
  // width (`sizeAttenuation`). Mixing GreasedLine material flavors in one
  // scene makes some drop out, so they must stay identical. Screen-relative
  // width honors `thickness`, stays a constant on-screen size at any zoom /
  // icon scale, and doesn't poke out of the drawing plane.
  const flat: number[] = [];
  for (const [x, y] of points) {
    flat.push(x, y, z);
  }
  const dash = patternIsDashed(pattern);
  const width = strokeWidthFor(thickness, scale);
  const mesh = CreateGreasedLine(
    baseName,
    { points: flat },
    {
      width,
      sizeAttenuation: true,
      color: colorToColor3(color),
      useDash: dash,
      dashCount: dash ? Math.max(8, points.length * 4) : 0,
      dashRatio: dash ? 0.5 : 0,
    },
    scene,
  );
  mesh.parent = parent;
  mesh.isPickable = false;
  return {
    dispose(): void {
      mesh.dispose(false, true);
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
