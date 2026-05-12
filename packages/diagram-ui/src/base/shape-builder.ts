import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  VertexData,
  type Scene,
} from "@babylonjs/core";
import {
  CreateDashedLines,
  CreateLines,
} from "@babylonjs/core/Meshes/Builders/linesBuilder.js";
import { expressionToString } from "@modelica-wrapper/diagram-svg";
import type {
  BitmapShape,
  Color,
  CoordinateSystem,
  EllipseShape,
  Extent,
  IconLayer,
  LineShape,
  PolygonShape,
  RectangleShape,
  Shape,
  TextShape,
} from "@modelica-wrapper/omc-client";

/**
 * Builds Babylon meshes directly from `IconLayer[]` — the path that
 * replaces the SVG-rasterized texture approach. Each shape becomes one
 * (filled) `Mesh` plus, optionally, a stroke `LinesMesh`. All meshes
 * are parented under a single graphics `TransformNode` so callers can
 * dispose the whole group in one go.
 *
 * Coordinate convention: shapes are written in icon coordinates as
 * emitted by `omc-client`'s producer. The caller (OmShapeNode) wraps
 * the builder's root in a TransformNode whose `setPlacement` scales
 * those icon coords into placement-local units; the builder itself
 * does not translate or scale the input.
 *
 * The builder owns nothing it doesn't return — `ShapeGroup.dispose()`
 * tears down every mesh, material, and texture it created. Materials
 * and dynamic textures are per-shape: with ~10-50 shapes per class
 * that's cheap, and it keeps the dispose path trivial. If perf
 * becomes an issue, the obvious step is sharing a solid-color
 * material per fillColor — premature now.
 */

const SHAPE_Z_STEP = 0.001;
const STROKE_Z_DELTA = 0.0005;
const DEFAULT_LINE_COLOR: Color = [0, 0, 0];

/** Modelica's "auto-fit" font size 0 → 12 user units (matches diagram-svg). */
const DEFAULT_FONT_SIZE = 12;
/** Canvas pixels per icon unit when sizing the DynamicTexture for text. */
const TEXT_TEXTURE_PIXELS_PER_UNIT = 4;
const MIN_TEXT_TEXTURE_EDGE = 32;

export interface ShapeGroup {
  /** TransformNode containing every shape mesh — child of `parent`. */
  root: TransformNode;
  /** Tear down every owned mesh, material, and texture. */
  dispose(): void;
}

/**
 * Build native Babylon meshes for every shape in every layer, in input
 * order (ancestor-first / host-last so later shapes paint on top).
 *
 * `coordinateSystem` describes the icon coord system — its centre is
 * subtracted from each shape's coordinates so the icon centre sits at
 * `root.position = (0, 0, 0)` and rotation pivots correctly.
 */
export function buildShapeMeshes(
  scene: Scene,
  parent: TransformNode,
  layers: ReadonlyArray<IconLayer>,
  _coordinateSystem: CoordinateSystem | undefined,
  baseName: string,
): ShapeGroup {
  // Coord-system centre is handled at the OmShapeNode layer (via the
  // hit-plane offset); shapes live in raw icon coords inside the
  // builder's root transform.
  void _coordinateSystem;
  const root = new TransformNode(`${baseName}-shapes`, scene);
  root.parent = parent;

  const owned: Array<{ dispose(): void }> = [];

  let drawOrder = 0;
  for (const layer of layers) {
    for (const shape of layer.shapes) {
      // Negative z moves a mesh toward the camera (camera sits at -Z),
      // so later shapes draw on top by accumulating a small negative
      // delta per shape.
      const z = -drawOrder * SHAPE_Z_STEP;
      const meshes = buildShape(scene, root, shape, z, `${baseName}.${drawOrder}`);
      owned.push(...meshes);
      drawOrder++;
    }
  }

  return {
    root,
    dispose(): void {
      for (const o of owned) {
        o.dispose();
      }
      owned.length = 0;
      root.dispose();
    },
  };
}

interface OwnedResource {
  dispose(): void;
}

function buildShape(
  scene: Scene,
  parent: TransformNode,
  shape: Shape,
  z: number,
  baseName: string,
): OwnedResource[] {
  switch (shape.kind) {
    case "line":
      return buildLine(scene, parent, shape, z, baseName);
    case "polygon":
      return buildPolygon(scene, parent, shape, z, baseName);
    case "rectangle":
      return buildRectangle(scene, parent, shape, z, baseName);
    case "ellipse":
      return buildEllipse(scene, parent, shape, z, baseName);
    case "text":
      return buildText(scene, parent, shape, z, baseName);
    case "bitmap":
      return buildBitmap(scene, parent, shape, z, baseName);
    default: {
      const _exhaustive: never = shape;
      void _exhaustive;
      return [];
    }
  }
}

// ---------- line ----------

function buildLine(
  scene: Scene,
  parent: TransformNode,
  s: LineShape,
  z: number,
  baseName: string,
): OwnedResource[] {
  if (s.points.length < 2) {
    return [];
  }
  const stroke = buildStroke(
    scene,
    parent,
    s.points,
    s.color ?? DEFAULT_LINE_COLOR,
    s.pattern,
    z,
    `${baseName}.line`,
  );
  return stroke ? [stroke] : [];
}

// ---------- polygon ----------

function buildPolygon(
  scene: Scene,
  parent: TransformNode,
  s: PolygonShape,
  z: number,
  baseName: string,
): OwnedResource[] {
  const owned: OwnedResource[] = [];
  // Drop a trailing duplicate of the first point — Modelica polygons
  // often close themselves explicitly, but the triangulator wants the
  // open vertex list.
  const points = stripClosingDuplicate(s.points);
  if (points.length < 3) {
    return owned;
  }

  if (s.fillPattern !== "None") {
    const fillColor = s.fillColor;
    if (fillColor) {
      const fill = buildFilledPolygon(
        scene,
        parent,
        points,
        fillColor,
        z,
        `${baseName}.fill`,
      );
      if (fill) {
        owned.push(fill);
      }
    }
  }

  // Stroke: close the path so the outline meets up.
  const strokePoints = [...points, points[0]!];
  const stroke = buildStroke(
    scene,
    parent,
    strokePoints,
    s.lineColor ?? DEFAULT_LINE_COLOR,
    s.pattern,
    z + STROKE_Z_DELTA,
    `${baseName}.stroke`,
  );
  if (stroke) {
    owned.push(stroke);
  }
  return owned;
}

// ---------- rectangle ----------

function buildRectangle(
  scene: Scene,
  parent: TransformNode,
  s: RectangleShape,
  z: number,
  baseName: string,
): OwnedResource[] {
  const owned: OwnedResource[] = [];
  const { x, y, width, height } = extentToRect(s.extent);
  if (width <= 0 || height <= 0) {
    return owned;
  }

  // v1: ignore `radius`. Rounded corners need a custom mesh; flagged in
  // the renderer-parity TODOs. Solid rect is the dominant case.
  const corners: ReadonlyArray<readonly [number, number]> = [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ];

  if (s.fillPattern !== "None") {
    const fillColor = s.fillColor;
    if (fillColor) {
      const fill = buildFilledQuad(
        scene,
        parent,
        x + width / 2,
        y + height / 2,
        width,
        height,
        fillColor,
        z,
        `${baseName}.fill`,
      );
      owned.push(fill);
    }
  }

  const strokePoints = [...corners, corners[0]!];
  const stroke = buildStroke(
    scene,
    parent,
    strokePoints,
    s.lineColor ?? DEFAULT_LINE_COLOR,
    s.pattern,
    z + STROKE_Z_DELTA,
    `${baseName}.stroke`,
  );
  if (stroke) {
    owned.push(stroke);
  }
  return owned;
}

// ---------- ellipse ----------

const ELLIPSE_SEGMENTS = 64;

function buildEllipse(
  scene: Scene,
  parent: TransformNode,
  s: EllipseShape,
  z: number,
  baseName: string,
): OwnedResource[] {
  const owned: OwnedResource[] = [];
  const { x, y, width, height } = extentToRect(s.extent);
  if (width <= 0 || height <= 0) {
    return owned;
  }
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width / 2;
  const ry = height / 2;

  // v1 ignores startAngle/endAngle/closure — emit the full ellipse.
  // Matches diagram-svg v1 behaviour; flagged for a follow-up.
  const ring: Array<[number, number]> = [];
  for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
    const t = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
    ring.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
  }

  if (s.fillPattern !== "None") {
    const fillColor = s.fillColor;
    if (fillColor) {
      const fill = buildFanFromCenter(
        scene,
        parent,
        cx,
        cy,
        ring,
        fillColor,
        z,
        `${baseName}.fill`,
      );
      owned.push(fill);
    }
  }

  const strokePoints = [...ring, ring[0]!];
  const stroke = buildStroke(
    scene,
    parent,
    strokePoints,
    s.lineColor ?? DEFAULT_LINE_COLOR,
    s.pattern,
    z + STROKE_Z_DELTA,
    `${baseName}.stroke`,
  );
  if (stroke) {
    owned.push(stroke);
  }
  return owned;
}

// ---------- text ----------

function buildText(
  scene: Scene,
  parent: TransformNode,
  s: TextShape,
  z: number,
  baseName: string,
): OwnedResource[] {
  const { x, y, width, height } = extentToRect(s.extent);
  if (width <= 0 || height <= 0) {
    return [];
  }
  const body = expressionToString(s.textString);
  if (!body) {
    return [];
  }

  const fontSize =
    s.fontSize && s.fontSize > 0 ? s.fontSize : DEFAULT_FONT_SIZE;
  const fontFamily =
    s.fontName && s.fontName.length > 0 ? s.fontName : "sans-serif";

  // Texture dimensions tracked to the plane aspect ratio so the canvas
  // glyphs don't stretch when the plane is mapped onto it.
  const texW = Math.max(
    MIN_TEXT_TEXTURE_EDGE,
    Math.round(width * TEXT_TEXTURE_PIXELS_PER_UNIT),
  );
  const texH = Math.max(
    MIN_TEXT_TEXTURE_EDGE,
    Math.round(height * TEXT_TEXTURE_PIXELS_PER_UNIT),
  );

  const texture = new DynamicTexture(
    `${baseName}.tex`,
    { width: texW, height: texH },
    scene,
    false,
  );
  texture.hasAlpha = true;

  // NullEngine in headless tests returns a null context — skip the
  // canvas draw call entirely. The plane mesh still mounts so layout
  // tests can count children.
  const ctx = texture.getContext() as CanvasRenderingContext2D | null;
  if (ctx) {
    ctx.clearRect(0, 0, texW, texH);
    // Pick a font-pixel size such that the text height matches the
    // icon's font size relative to the extent height.
    const pixelFont = Math.max(8, Math.round((fontSize / height) * texH));
    ctx.font = `${pixelFont}px ${fontFamily}`;
    ctx.fillStyle = colorToCss(s.textColor, "rgb(0,0,0)");

    const align = s.horizontalAlignment ?? "Center";
    let drawX: number;
    switch (align) {
      case "Left":
        ctx.textAlign = "left";
        drawX = 0;
        break;
      case "Right":
        ctx.textAlign = "right";
        drawX = texW;
        break;
      case "Center":
      default:
        ctx.textAlign = "center";
        drawX = texW / 2;
        break;
    }
    ctx.textBaseline = "middle";
    ctx.fillText(body, drawX, texH / 2);
    texture.update();
  }

  const material = new StandardMaterial(`${baseName}.tex.mat`, scene);
  material.disableLighting = true;
  material.specularColor = new Color3(0, 0, 0);
  material.emissiveColor = new Color3(1, 1, 1);
  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  material.backFaceCulling = false;

  const plane = MeshBuilder.CreatePlane(
    `${baseName}.tex.plane`,
    { width, height, sideOrientation: Mesh.DOUBLESIDE },
    scene,
  );
  plane.material = material;
  plane.parent = parent;
  plane.position.set(x + width / 2, y + height / 2, z);
  // Text shapes participate in picking only as decoration — the
  // entity's hit plane is the authoritative target.
  plane.isPickable = false;

  return [
    {
      dispose(): void {
        plane.dispose();
        material.dispose();
        texture.dispose();
      },
    },
  ];
}

// ---------- bitmap ----------

function buildBitmap(
  scene: Scene,
  parent: TransformNode,
  s: BitmapShape,
  z: number,
  baseName: string,
): OwnedResource[] {
  const { x, y, width, height } = extentToRect(s.extent);
  if (width <= 0 || height <= 0) {
    return [];
  }
  const url = resolveBitmapUrl(s);
  if (!url) {
    return [];
  }

  const texture = new Texture(url, scene, true, false);
  texture.hasAlpha = true;

  const material = new StandardMaterial(`${baseName}.bmp.mat`, scene);
  material.disableLighting = true;
  material.specularColor = new Color3(0, 0, 0);
  material.emissiveColor = new Color3(1, 1, 1);
  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  material.backFaceCulling = false;

  const plane = MeshBuilder.CreatePlane(
    `${baseName}.bmp.plane`,
    { width, height, sideOrientation: Mesh.DOUBLESIDE },
    scene,
  );
  plane.material = material;
  plane.parent = parent;
  plane.position.set(x + width / 2, y + height / 2, z);
  plane.isPickable = false;

  return [
    {
      dispose(): void {
        plane.dispose();
        material.dispose();
        texture.dispose();
      },
    },
  ];
}

function resolveBitmapUrl(s: BitmapShape): string | undefined {
  const src = s.imageSource;
  if (typeof src === "string" && src.length > 0) {
    if (src.startsWith("data:")) return src;
    // Raw base64 PNG signature: `iVBOR...`. Wrap it so the texture
    // loader recognises the encoding.
    if (src.startsWith("iVBOR")) return `data:image/png;base64,${src}`;
    return src;
  }
  if (typeof s.fileName === "string" && s.fileName.length > 0) {
    return s.fileName;
  }
  return undefined;
}

// ---------- shared mesh builders ----------

function buildFilledQuad(
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

function buildFanFromCenter(
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
  const mesh = makeMeshFromTriangles(scene, baseName, positions, indices);
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

function buildFilledPolygon(
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

function makeMeshFromTriangles(
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

function makeUnlitMaterial(
  scene: Scene,
  color: Color,
  name: string,
): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.disableLighting = true;
  mat.specularColor = new Color3(0, 0, 0);
  mat.emissiveColor = colorToColor3(color);
  // Filled regions are typically meant to be opaque even if the SVG
  // path was using fill-opacity tricks — Modelica annotations don't
  // expose alpha, so this is uncontroversial for v1.
  mat.backFaceCulling = false;
  return mat;
}

// ---------- stroke (polyline) ----------

const DEFAULT_DASH_SIZE = 4;
const DEFAULT_DASH_GAP = 3;

function buildStroke(
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
  // Iterate CCW for the ear-test orientation checks; if the input is
  // CW, walk the indices in reverse so the test sees CCW.
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
      // Degenerate polygon (self-intersecting, collinear, ...). Bail
      // out — better to render nothing than an incorrect triangulation.
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
  // Reflex (concave) vertices can't be the apex of an ear.
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

// ---------- helpers ----------

interface RectBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function extentToRect(extent: Extent): RectBox {
  const [[x1, y1], [x2, y2]] = extent;
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function stripClosingDuplicate(
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

function colorToColor3(color: Color | undefined): Color3 {
  if (!color || color.length !== 3) {
    return new Color3(0, 0, 0);
  }
  const [r, g, b] = color;
  return new Color3(clampByte(r) / 255, clampByte(g) / 255, clampByte(b) / 255);
}

function colorToCss(color: Color | undefined, fallback: string): string {
  if (!color || color.length !== 3) return fallback;
  const [r, g, b] = color;
  return `rgb(${clampByte(r)},${clampByte(g)},${clampByte(b)})`;
}

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 255) return 255;
  return Math.round(n);
}
