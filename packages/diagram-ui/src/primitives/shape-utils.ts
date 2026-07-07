import { Container, Graphics, Matrix, type Renderer } from "pixi.js";
import type { Color, Extent, Point } from "@dicode/omc-client";
import type { FillSpec } from "@dicode/diagram-svg";

import { worldScaleXY } from "../scene/ortho-camera.js";
import { resolveFillTexture } from "./fill-texture.js";

/** Per-shape GraphicItem transform fields (§18.6) every primitive carries. */
export interface GraphicItemTransform {
  origin?: [number, number] | undefined;
  rotation?: number | undefined;
}

/**
 * Return the container a shape's geometry should attach to, honouring the
 * shape's own `origin` / `rotation`. When both are default, `parent` is
 * returned unchanged (no extra node). Otherwise a child `Container` is created
 * at `origin`, rotated `rotation` degrees about Z, and returned; the caller
 * pushes its `dispose` onto `resources` so it tears down with the shape.
 *
 * The Y-flip lives on the diagram root, so the negative-determinant ancestor
 * already turns Modelica's CCW-positive degrees into CCW on screen — the angle
 * is assigned directly with no sign negation.
 */
export function graphicItemNode(
  parent: Container,
  shape: GraphicItemTransform,
  name: string,
): { node: Container; dispose: () => void } {
  const ox = shape.origin?.[0] ?? 0;
  const oy = shape.origin?.[1] ?? 0;
  const rot = shape.rotation ?? 0;
  if (ox === 0 && oy === 0 && rot === 0) {
    return { node: parent, dispose: () => {} };
  }
  const node = new Container({ label: name });
  node.sortableChildren = true;
  node.position.set(ox, oy);
  node.rotation = (rot * Math.PI) / 180;
  parent.addChild(node);
  return { node, dispose: () => node.destroy({ children: true }) };
}

/**
 * Shared helpers for the `<om-{rectangle, polygon, line, ellipse, text,
 * bitmap}>` primitive components. Each primitive owns its own graphics
 * lifecycle but hands back this same `OwnedResource` so the base class can
 * dispose them uniformly.
 */
export interface OwnedResource {
  dispose(): void;
}

/**
 * zIndex step between consecutive shapes in an icon. Higher `zOrder` paints
 * on top, so the step is positive (larger zIndex = front).
 */
export const SHAPE_Z_STEP = 0.001;
/** Extra zIndex applied to a stroke so its outline draws above its own fill. */
export const STROKE_Z_DELTA = 0.0005;
export const DEFAULT_LINE_COLOR: Color = [0, 0, 0];

/** zIndex for a shape from its zero-based draw index. */
export function zForOrder(zOrder: number): number {
  return zOrder * SHAPE_Z_STEP;
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

/** Quarter-circle segment count per rounded corner. */
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
 *  often close themselves explicitly, but the fill + stroke builders want
 *  the open vertex list. */
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

/** Pack a Modelica `Color` (0..255 triplet) into a `0xRRGGBB` integer. */
export function packColor(color: Color | undefined): number {
  if (!color || color.length !== 3) {
    return 0x000000;
  }
  const [r, g, b] = color;
  return (clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b);
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

// ---------- fills ----------

/** The flat colour a fill spec degrades to without its baked texture. */
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

/**
 * Texture-pixel → local matrix for a hatch tile in `global` texture space:
 * one tile (its full pixel width) maps to `spec.spacing` diagram units, so the
 * line density stays fixed in icon units under zoom (with `repeat` addressing)
 * rather than stretching with the shape.
 */
function hatchMatrix(spacing: number, box: RectBox, texW: number): Matrix {
  const s = spacing / (texW || 1);
  return new Matrix().scale(s, s).translate(box.x, box.y);
}

/**
 * Fill an already-pathed `Graphics`. Solid specs fill flat; gradients fill the
 * baked texture stretched to the shape bounds (default `local` texture space);
 * hatches tile their baked tile at a fixed icon-unit density (`global` space +
 * {@link hatchMatrix}). The fill degrades to the spec's representative flat
 * colour when the bake is unavailable (headless, or no 2D context). `none`
 * specs are filtered out by callers.
 */
function applyFill(
  renderer: Renderer | null,
  g: Graphics,
  spec: FillSpec,
  box: RectBox,
  aspect: number,
): void {
  if (spec.kind === "solid") {
    g.fill(packColor(spec.color));
    return;
  }
  const texture = resolveFillTexture(renderer, spec, aspect);
  if (!texture) {
    g.fill(packColor(fillSpecBaseColor(spec)));
    return;
  }
  if (spec.kind === "hatch") {
    g.fill({
      texture,
      matrix: hatchMatrix(spec.spacing, box, texture.width),
      textureSpace: "global",
    });
    return;
  }
  g.fill({ texture });
}

export function buildFilledRect(
  renderer: Renderer | null,
  parent: Container,
  box: RectBox,
  radius: number,
  spec: FillSpec,
  z: number,
  baseName: string,
): OwnedResource {
  const g = new Graphics({ label: baseName });
  g.eventMode = "none";
  g.zIndex = z;
  if (radius > 0) {
    g.roundRect(box.x, box.y, box.width, box.height, radius);
  } else {
    g.rect(box.x, box.y, box.width, box.height);
  }
  applyFill(
    renderer,
    g,
    spec,
    box,
    box.height > 0 ? box.width / box.height : 1,
  );
  parent.addChild(g);
  return { dispose: () => g.destroy() };
}

export function buildFilledEllipse(
  renderer: Renderer | null,
  parent: Container,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  box: RectBox,
  spec: FillSpec,
  z: number,
  baseName: string,
): OwnedResource {
  const g = new Graphics({ label: baseName });
  g.eventMode = "none";
  g.zIndex = z;
  g.ellipse(cx, cy, rx, ry);
  applyFill(
    renderer,
    g,
    spec,
    box,
    box.height > 0 ? box.width / box.height : 1,
  );
  parent.addChild(g);
  return { dispose: () => g.destroy() };
}

export function buildFilledPolygon(
  renderer: Renderer | null,
  parent: Container,
  points: ReadonlyArray<readonly [number, number]>,
  spec: FillSpec,
  z: number,
  baseName: string,
): OwnedResource | null {
  if (points.length < 3) {
    return null;
  }
  const flat: number[] = [];
  for (const [x, y] of points) {
    flat.push(x, y);
  }
  const box = pointsBox(points);
  const g = new Graphics({ label: baseName });
  g.eventMode = "none";
  g.zIndex = z;
  g.poly(flat);
  applyFill(
    renderer,
    g,
    spec,
    box,
    box.height > 0 ? box.width / box.height : 1,
  );
  parent.addChild(g);
  return { dispose: () => g.destroy() };
}

/** Axis-aligned bounding box of a point list, for fill-texture mapping. */
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

/** Modelica default stroke thickness (mm / diagram units). */
const DEFAULT_STROKE_THICKNESS = 0.25;
/** Floor (diagram units) so a hairline still reads at default zoom. */
const MIN_STROKE_WIDTH = 0.5;
/** Dash / gap length, nominally in CSS pixels — `buildStroke` scales these by
 *  `worldPerPixel` so the dash rhythm reads at a constant on-screen size
 *  across zoom. Used as raw diagram units when no `worldPerPixel` is given
 *  (e.g. a renderer-less caller with no scene context). Exported so
 *  `edge-build.ts`'s separate dash algorithm shares the same nominal
 *  rhythm instead of redeclaring its own copy. */
export const DEFAULT_DASH_SIZE = 4;
export const DEFAULT_DASH_GAP = 3;
/** Floor (diagram units) on a scaled dash/gap run so an extreme zoom-in
 *  can't shrink a run toward zero and blow up the segmentation loop. */
const MIN_DASH_RUN = 0.05;

/**
 * Accumulated diagram-space scale of a container as a single factor — the
 * geometric mean of its absolute x/y scale (a stroke width is uniform, so it
 * can't honour x and y separately). The view (pan/zoom) transform is excluded,
 * so the value reflects only the icon→placement chain.
 */
export function worldScaleOf(node: Container): number {
  const { x, y } = worldScaleXY(node);
  return Math.sqrt(Math.abs(x * y)) || 1;
}

/**
 * Local (icon-space) stroke width for a Modelica `thickness`, scale-compensated
 * against `parent` the same way {@link buildStroke} compensates its own stroke
 * — so a caller drawing stroke-consistent geometry alongside the main stroke
 * (e.g. an arrowhead outline) matches its on-screen width.
 */
export function resolveStrokeWidth(
  parent: Container,
  thickness: number | undefined,
  lineThicknessScale: number | undefined,
): number {
  const worldScale = worldScaleOf(parent);
  const naturalWidth =
    (thickness ?? DEFAULT_STROKE_THICKNESS) * (lineThicknessScale ?? 1);
  return Math.max(naturalWidth, MIN_STROKE_WIDTH) / worldScale;
}

export function buildStroke(
  parent: Container,
  points: ReadonlyArray<readonly [number, number]>,
  color: Color,
  pattern: string | undefined,
  z: number,
  baseName: string,
  opts?: {
    thickness?: number | undefined;
    lineThicknessScale?: number | undefined;
    worldPerPixel?: number | undefined;
  },
): OwnedResource | null {
  if (points.length < 2 || pattern === "None") {
    return null;
  }
  const { thickness, lineThicknessScale, worldPerPixel } = opts ?? {};
  const colour = packColor(color);
  const g = new Graphics({ label: baseName });
  g.eventMode = "none";
  g.zIndex = z;

  // Stroke width is scale-compensated: the rendered width is multiplied by the
  // container's diagram-space scale, so the local width divides that scale out
  // to keep the on-screen width invariant (Modelica thickness is a screen-space
  // quantity, not an icon-space one), floored so it never goes sub-pixel.
  const worldScale = worldScaleOf(parent);
  const localWidth = resolveStrokeWidth(parent, thickness, lineThicknessScale);

  const dashRuns = dashRunsFor(pattern);
  if (dashRuns) {
    // Pixi has no native dash, so the path is segmented by arc length. Scale
    // the nominal CSS-pixel runs to local units the same way stroke width is
    // scale-compensated, so the dash rhythm reads constant on screen across
    // zoom (and icon scale) instead of stretching/compressing with either.
    const dashScale =
      worldPerPixel !== undefined &&
      Number.isFinite(worldPerPixel) &&
      worldPerPixel > 0
        ? worldPerPixel / worldScale
        : 1;
    const scaledRuns = dashRuns.map((r) =>
      Math.max(MIN_DASH_RUN, r * dashScale),
    );
    if (!strokeDashedPath(g, points, scaledRuns)) {
      g.destroy();
      return null;
    }
  } else if (!strokePath(g, points)) {
    g.destroy();
    return null;
  }
  g.stroke({
    width: localWidth,
    color: colour,
    cap: "round",
    join: "round",
    alignment: 0.5,
  });

  parent.addChild(g);
  return { dispose: () => g.destroy() };
}

/** Trace a polyline, skipping zero-length segments. Returns `false` when no
 *  drawable segment exists. */
function strokePath(
  g: Graphics,
  points: ReadonlyArray<readonly [number, number]>,
): boolean {
  let drawn = false;
  let prev: readonly [number, number] | undefined;
  for (const p of points) {
    if (prev === undefined) {
      g.moveTo(p[0], p[1]);
      prev = p;
      continue;
    }
    if (p[0] === prev[0] && p[1] === prev[1]) {
      continue;
    }
    g.lineTo(p[0], p[1]);
    prev = p;
    drawn = true;
  }
  return drawn;
}

/** Emit the dash / gap runs in `runs` (even indices draw, odd skip) along the
 *  polyline by accumulated arc length, cycling the pattern so its phase is
 *  continuous across segment joints. Returns `false` when nothing was drawn. */
function strokeDashedPath(
  g: Graphics,
  points: ReadonlyArray<readonly [number, number]>,
  runs: readonly number[],
): boolean {
  let drawn = false;
  let runIdx = 0;
  let runLen = runs[0] ?? DEFAULT_DASH_SIZE;
  let covered = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) {
      continue;
    }
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (segLen === 0) {
      continue;
    }
    const ux = (b[0] - a[0]) / segLen;
    const uy = (b[1] - a[1]) / segLen;
    let pos = 0;
    while (pos < segLen - 1e-9) {
      const step = Math.min(segLen - pos, runLen - covered);
      if (runIdx % 2 === 0) {
        g.moveTo(a[0] + ux * pos, a[1] + uy * pos).lineTo(
          a[0] + ux * (pos + step),
          a[1] + uy * (pos + step),
        );
        drawn = true;
      }
      pos += step;
      covered += step;
      if (covered >= runLen - 1e-9) {
        covered = 0;
        runIdx = (runIdx + 1) % runs.length;
        runLen = runs[runIdx] ?? DEFAULT_DASH_SIZE;
      }
    }
  }
  return drawn;
}

/** Dot run length (diagram units) — a short dash that reads as a point. */
const DEFAULT_DOT_SIZE = 1;

/** Dash / gap run lengths (diagram units) keyed by Modelica `LinePattern`; even
 *  indices draw, odd indices skip. */
const DASH_RUNS: Readonly<Record<string, readonly number[]>> = {
  Dash: [DEFAULT_DASH_SIZE, DEFAULT_DASH_GAP],
  Dot: [DEFAULT_DOT_SIZE, DEFAULT_DASH_GAP],
  DashDot: [
    DEFAULT_DASH_SIZE,
    DEFAULT_DASH_GAP,
    DEFAULT_DOT_SIZE,
    DEFAULT_DASH_GAP,
  ],
  DashDotDot: [
    DEFAULT_DASH_SIZE,
    DEFAULT_DASH_GAP,
    DEFAULT_DOT_SIZE,
    DEFAULT_DASH_GAP,
    DEFAULT_DOT_SIZE,
    DEFAULT_DASH_GAP,
  ],
};

/** Dash/gap runs for a dashed `LinePattern`, or `null` for solid / `"None"`.
 *  Unknown dashed-looking patterns fall back to a plain dash. Exported so
 *  callers can tell whether a stroke needs to react to zoom (re-running
 *  `buildStroke` to keep its dash rhythm screen-constant). */
export function dashRunsFor(
  pattern: string | undefined,
): readonly number[] | null {
  if (pattern === undefined || pattern === "None" || pattern === "Solid") {
    return null;
  }
  return DASH_RUNS[pattern] ?? DASH_RUNS.Dash ?? null;
}
