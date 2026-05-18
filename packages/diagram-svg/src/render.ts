/**
 * Core SVG renderer for `IconLayer[]` produced upstream.
 *
 * Approach:
 *  - Modelica icons use `+y up`; SVG uses `+y down`. We wrap every layer in
 *    a single root `<g transform="scale(1,-1)">` so the per-shape mappers
 *    can write coordinates verbatim. The `viewBox` is computed from the
 *    chosen `coordinateSystem.extent` with `y` flipped to compensate for
 *    the root scale (see `computeViewBox`).
 *  - Each `IconLayer` becomes one `<g class="diagram-svg-layer" data-from="...">`,
 *    in input order. The producer emits ancestor-first / host-last, so
 *    later layers paint on top — that's how we want the host class's icon
 *    to override anything inherited.
 *  - Shape mappers emit minimal, static SVG. No marker defs, no pattern
 *    defs (yet); see TODOs at each shape.
 *  - Colors / patterns / expressions go through the helper modules so the
 *    behaviour is uniform across shape kinds.
 *
 * What this file does NOT do:
 *  - placement transforms / sub-component composition (that's the next
 *    layer up — diagram-mode rendering takes `ComponentInstance` placements
 *    into account, and lives elsewhere)
 *  - arc rendering for ellipse `startAngle`/`endAngle` (TODO; v1 emits the
 *    bounding ellipse)
 *  - line arrow markers (TODO; v1 ignores `arrow` / `arrowSize`)
 *  - hatch fill patterns (Horizontal/Vertical/Cross/Forward/Backward/CrossDiag —
 *    they need `<pattern>` tile defs; out of scope for v1). Cylinder and
 *    Sphere ARE handled via gradient defs (see pattern.ts).
 */

import { colorToCss } from "./color.js";
import { expressionToString } from "./expression.js";
import { linePatternToDashArray, resolveFill } from "./pattern.js";
import type {
  BitmapShape,
  ClassDef,
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
} from "./types.js";

/**
 * Options for `renderIconLayersToSvg` / `renderClassIconToSvg`.
 *
 * All optional — the renderer falls back to Modelica-default coordinates
 * (`[[-100,-100],[100,100]]`) and emits no `width`/`height` so the SVG
 * scales to its container.
 */
export interface RenderOptions {
  /**
   * Coordinate system that determines the SVG viewBox. If omitted: pick
   * the LAST layer's coordinateSystem if any (host class wins), else
   * Modelica's default extent.
   */
  coordinateSystem?: CoordinateSystem | undefined;
  /**
   * Force an on-page render size in CSS pixels. Aspect ratio is preserved
   * by the viewBox, so this only controls footprint.
   */
  size?: number | { width: number; height: number } | undefined;
  /**
   * Background fill behind the icon. Useful for stories so the icon
   * doesn't disappear against the page. Default: no background.
   */
  background?: string | undefined;
  /**
   * When `true`, the viewBox is enlarged to fit every shape extent in
   * addition to the coordinate-system extent. Matches OMEdit, which
   * shows labels (`%name`, parameter readouts) and other annotations
   * placed outside the canonical icon box.
   *
   * Default `false` for backwards compatibility — the icon-provider
   * cache and the in-canvas textured plane assume viewBox = coord-
   * system extent. The HTML overlay path opts in.
   */
  expandViewBoxToShapes?: boolean | undefined;
  /**
   * Multiplier applied to every `stroke-width` (the bumped
   * spec-default fallback AND explicit `lineThickness` annotations).
   * Modelica thicknesses are in icon coordinate units; at the
   * canonical `[-100,100]` extent rendered at ~200 CSS pixels they
   * produce hair-thin strokes that disappear on high-density
   * displays. Default `10` keeps strokes legible at typical zoom
   * while still preserving the relative weights modellers intend.
   *
   * Pass `1` to render at the literal annotation thickness.
   */
  lineThicknessScale?: number | undefined;
}

const DEFAULT_LINE_THICKNESS_SCALE = 10;
/**
 * Fallback stroke width when a shape's annotation omits `thickness` /
 * `lineThickness`. Modelica's spec default is `0.25` icon units, but
 * that renders as a hair-thin near-invisible line at typical zoom. We
 * lift the fallback to `0.25 × 5 = 1.25` so unspecified strokes stay
 * legible. Explicit annotation values are NOT touched here — they
 * only get the uniform `lineThicknessScale` multiplier.
 */
const SPEC_DEFAULT_THICKNESS = 0.25 * 5;

/** Axis-aligned box in icon coordinates. */
export interface IconBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const DEFAULT_EXTENT: Extent = [
  [-100, -100],
  [100, 100],
];

// ---------- public API ----------

/**
 * Render a list of icon layers (in draw order — ancestor first, host last)
 * into a self-contained SVG string. Returns a complete `<svg>` document
 * including `viewBox`, root y-flip transform, and one
 * `<g class="diagram-svg-layer" data-from="...">` per layer.
 */
export function renderIconLayersToSvg(
  layers: IconLayer[],
  opts: RenderOptions = {},
): string {
  const cs = pickCoordinateSystem(layers, opts.coordinateSystem);
  const baseExtent = normaliseExtent(cs?.extent) ?? DEFAULT_EXTENT;
  const extent = opts.expandViewBoxToShapes
    ? boundsToExtent(unionWithShapes(extentToBounds(baseExtent), layers))
    : baseExtent;
  const viewBox = computeViewBox(extent);

  const sizeAttrs = renderSizeAttributes(opts.size);
  const background = renderBackground(extent, opts.background);

  // Render shapes first so the gradient-def collector populates before we
  // serialize. Each cylinder/sphere fill registers one entry per unique
  // (kind, edge, middle) tuple; identical fills across shapes share a def.
  const ctx: RenderContext = {
    defs: new Map(),
    lineThicknessScale: opts.lineThicknessScale ?? DEFAULT_LINE_THICKNESS_SCALE,
  };
  const layerGroups = layers.map((l) => renderLayer(l, ctx)).join("");
  const defsBlock =
    ctx.defs.size > 0
      ? `<defs>${Array.from(ctx.defs.values()).join("")}</defs>`
      : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg"${sizeAttrs} viewBox="${viewBox}">`,
    defsBlock,
    background,
    `<g transform="scale(1,-1)">`,
    layerGroups,
    `</g>`,
    `</svg>`,
  ].join("");
}

/**
 * Convenience wrapper that takes a `ClassDef` (from the producer's
 * `classes` map) and renders its `iconLayers` using the class's own
 * coordinate system as the default.
 */
export function renderClassIconToSvg(
  cls: ClassDef,
  opts: RenderOptions = {},
): string {
  const merged: RenderOptions = {
    ...opts,
    coordinateSystem:
      opts.coordinateSystem ?? cls.coordinateSystem ?? undefined,
  };
  return renderIconLayersToSvg(cls.iconLayers, merged);
}

// ---------- bounds (coord-system ∪ shapes) ----------

/**
 * Union of the coord-system extent (or Modelica default) with every
 * shape extent across every layer. Use for sizing overlay containers,
 * the in-canvas plane mesh, or any "where does this icon visually
 * extend" calculation — including labels that Modelica annotations
 * routinely place outside the canonical icon box (`%name`, parameter
 * readouts, dimension callouts).
 *
 * Returns an axis-aligned box in icon coordinates.
 */
export function computeIconBounds(
  layers: IconLayer[],
  coordinateSystem?: CoordinateSystem | undefined,
): IconBounds {
  const cs = pickCoordinateSystem(layers, coordinateSystem);
  const base = normaliseExtent(cs?.extent) ?? DEFAULT_EXTENT;
  return unionWithShapes(extentToBounds(base), layers);
}

function extentToBounds(extent: Extent): IconBounds {
  const [[x1, y1], [x2, y2]] = extent;
  return {
    minX: Math.min(x1, x2),
    minY: Math.min(y1, y2),
    maxX: Math.max(x1, x2),
    maxY: Math.max(y1, y2),
  };
}

function boundsToExtent(b: IconBounds): Extent {
  return [
    [b.minX, b.minY],
    [b.maxX, b.maxY],
  ];
}

function unionWithShapes(seed: IconBounds, layers: IconLayer[]): IconBounds {
  let { minX, minY, maxX, maxY } = seed;
  const visit = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const layer of layers) {
    for (const shape of layer.shapes) {
      visitShapeCorners(shape, visit);
    }
  }
  return { minX, minY, maxX, maxY };
}

function visitShapeCorners(
  shape: import("./types.js").Shape,
  visit: (x: number, y: number) => void,
): void {
  switch (shape.kind) {
    case "line":
    case "polygon": {
      for (const [x, y] of shape.points) {
        visit(x, y);
      }
      return;
    }
    case "rectangle":
    case "ellipse":
    case "text":
    case "bitmap": {
      const [[x1, y1], [x2, y2]] = shape.extent;
      visit(x1, y1);
      visit(x2, y2);
      return;
    }
  }
}

// ---------- coordinate system / viewBox ----------

function pickCoordinateSystem(
  layers: IconLayer[],
  override: CoordinateSystem | undefined,
): CoordinateSystem | undefined {
  if (override) return override;
  for (let i = layers.length - 1; i >= 0; i--) {
    const cs = layers[i]?.coordinateSystem;
    if (cs) return cs;
  }
  return undefined;
}

/**
 * `CoordinateSystem.extent` upstream is typed `number[][]` (it's loose
 * because OMC sometimes emits ragged arrays). We tighten it here, falling
 * back to `undefined` if the shape is malformed.
 */
function normaliseExtent(raw: number[][] | undefined): Extent | undefined {
  if (!raw || raw.length !== 2) return undefined;
  const a = raw[0];
  const b = raw[1];
  if (!a || !b || a.length < 2 || b.length < 2) return undefined;
  const [x1, y1] = a as [number, number, ...number[]];
  const [x2, y2] = b as [number, number, ...number[]];
  if (![x1, y1, x2, y2].every(Number.isFinite)) return undefined;
  return [
    [x1, y1],
    [x2, y2],
  ];
}

/**
 * Compute the SVG `viewBox` from a Modelica extent, accounting for the
 * `scale(1,-1)` we apply to the root group.
 *
 * Modelica extent `[[x1,y1],[x2,y2]]` describes a box where (x1,y1) is
 * one corner and (x2,y2) the opposite. After `scale(1,-1)` the box's
 * `y` range flips to `[-y2, -y1]`, so the viewBox needs to start at
 * `min(-y1, -y2)`.
 */
function computeViewBox(extent: Extent): string {
  const [[x1, y1], [x2, y2]] = extent;
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const width = maxX - minX;
  const height = maxY - minY;
  // After scale(1,-1), the world y-range [minY, maxY] maps to SVG
  // y-range [-maxY, -minY]. Use the smaller (i.e. -maxY) as the viewBox
  // origin.
  return `${minX} ${-maxY} ${width} ${height}`;
}

function renderSizeAttributes(
  size: RenderOptions["size"],
): string {
  if (size === undefined) return "";
  if (typeof size === "number") return ` width="${size}" height="${size}"`;
  return ` width="${size.width}" height="${size.height}"`;
}

function renderBackground(
  extent: Extent,
  background: string | undefined,
): string {
  if (!background) return "";
  const [[x1, y1], [x2, y2]] = extent;
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  // We render the background BEFORE the y-flip group so it can ignore the
  // flip and just cover the viewBox area in SVG-native coordinates.
  const minYSvg = -Math.max(y1, y2);
  const maxYSvg = -Math.min(y1, y2);
  const width = maxX - minX;
  const height = maxYSvg - minYSvg;
  return `<rect x="${minX}" y="${minYSvg}" width="${width}" height="${height}" fill="${escapeAttr(background)}"/>`;
}

// ---------- layer + shape rendering ----------

/**
 * Per-render state passed through shape mappers. Collects unique
 * gradient defs so cylinder/sphere fills can share `<defs>` entries
 * across shapes (the `defs` Map is keyed by gradient id — see
 * `pattern.ts` — so duplicates are no-ops), and carries the
 * stroke-width scale so every shape mapper applies it uniformly.
 */
interface RenderContext {
  defs: Map<string, string>;
  lineThicknessScale: number;
}

function renderLayer(layer: IconLayer, ctx: RenderContext): string {
  const shapes = layer.shapes.map((s) => renderShape(s, ctx)).join("");
  return `<g class="diagram-svg-layer" data-from="${escapeAttr(layer.from)}">${shapes}</g>`;
}

function renderShape(shape: Shape, ctx: RenderContext): string {
  switch (shape.kind) {
    case "line":
      return renderLine(shape, ctx);
    case "polygon":
      return renderPolygon(shape, ctx);
    case "rectangle":
      return renderRectangle(shape, ctx);
    case "ellipse":
      return renderEllipse(shape, ctx);
    case "text":
      return renderText(shape);
    case "bitmap":
      return renderBitmap(shape);
    default: {
      // Exhaustiveness guard — if the producer adds a new shape kind we
      // emit nothing (rather than crash) and rely on TS to flag the gap.
      const _exhaustive: never = shape;
      void _exhaustive;
      return "";
    }
  }
}

/**
 * Apply the user's `lineThicknessScale` to an annotation's
 * (explicit-or-default) stroke width. Modelica's spec default of
 * `0.25` icon units is too thin on most displays — see
 * `RenderOptions.lineThicknessScale` for why. Defaults to `2× spec`.
 */
function scaledThickness(
  raw: number | undefined,
  ctx: RenderContext,
): number {
  const base = raw ?? SPEC_DEFAULT_THICKNESS;
  return base * ctx.lineThicknessScale;
}

/**
 * Look up + emit a `fill` attribute value, registering any gradient def
 * in the render context. Used by every filled shape mapper.
 */
function fillFor(
  fillColor: Color | undefined,
  lineColor: Color | undefined,
  pattern: string | undefined,
  ctx: RenderContext,
): string {
  const resolved = resolveFill({ fillColor, lineColor, pattern });
  if (resolved.def && !ctx.defs.has(resolved.def.id)) {
    ctx.defs.set(resolved.def.id, resolved.def.xml);
  }
  return resolved.value;
}

// ---- line ----

function renderLine(s: LineShape, ctx: RenderContext): string {
  const points = pointsToAttr(s.points);
  const stroke = colorToCss(s.color, "rgb(0,0,0)");
  const thickness = scaledThickness(s.thickness, ctx);
  const dashArray = linePatternToDashArray(s.pattern);
  const dashAttr = dashArray ? ` stroke-dasharray="${dashArray}"` : "";
  // TODO: arrow / arrowSize -> marker-start / marker-end via <defs>; v1
  // skips arrows entirely so straight lines render correctly without the
  // overhead of marker management.
  return `<polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="${thickness}"${dashAttr}/>`;
}

// ---- polygon ----

function renderPolygon(s: PolygonShape, ctx: RenderContext): string {
  const points = pointsToAttr(s.points);
  const stroke = colorToCss(s.lineColor, "rgb(0,0,0)");
  const fill = fillFor(s.fillColor, s.lineColor, s.fillPattern, ctx);
  const thickness = scaledThickness(s.lineThickness, ctx);
  const dashArray = linePatternToDashArray(s.pattern);
  const dashAttr = dashArray ? ` stroke-dasharray="${dashArray}"` : "";
  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${thickness}"${dashAttr}/>`;
}

// ---- rectangle ----

function renderRectangle(s: RectangleShape, ctx: RenderContext): string {
  const { x, y, width, height } = extentToRect(s.extent);
  const stroke = colorToCss(s.lineColor, "rgb(0,0,0)");
  const fill = fillFor(s.fillColor, s.lineColor, s.fillPattern, ctx);
  const thickness = scaledThickness(s.lineThickness, ctx);
  const dashArray = linePatternToDashArray(s.pattern);
  const dashAttr = dashArray ? ` stroke-dasharray="${dashArray}"` : "";
  const radiusAttr = s.radius && s.radius > 0 ? ` rx="${s.radius}" ry="${s.radius}"` : "";
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}"${radiusAttr} fill="${fill}" stroke="${stroke}" stroke-width="${thickness}"${dashAttr}/>`;
}

// ---- ellipse ----

function renderEllipse(s: EllipseShape, ctx: RenderContext): string {
  const { x, y, width, height } = extentToRect(s.extent);
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width / 2;
  const ry = height / 2;
  const stroke = colorToCss(s.lineColor, "rgb(0,0,0)");
  const fill = fillFor(s.fillColor, s.lineColor, s.fillPattern, ctx);
  const thickness = scaledThickness(s.lineThickness, ctx);
  const dashArray = linePatternToDashArray(s.pattern);
  const dashAttr = dashArray ? ` stroke-dasharray="${dashArray}"` : "";
  // TODO: honor startAngle / endAngle / closure ("None" | "Chord" | "Radial").
  // For now we always emit the full bounding ellipse — same visual as
  // `EllipseClosure.None` without rotation.
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${thickness}"${dashAttr}/>`;
}

// ---- text ----

function renderText(s: TextShape): string {
  const { x: ex1, y: ey1, width, height } = extentToRect(s.extent);
  const ex2 = ex1 + width;

  const align = s.horizontalAlignment ?? "Center";
  let xPos: number;
  let textAnchor: string;
  switch (align) {
    case "Left":
      xPos = ex1;
      textAnchor = "start";
      break;
    case "Right":
      xPos = ex2;
      textAnchor = "end";
      break;
    case "Center":
    default:
      xPos = ex1 + width / 2;
      textAnchor = "middle";
      break;
  }
  const yPos = ey1 + height / 2;

  // Modelica's `fontSize == 0` means "auto-fit to extent". Auto-fitting
  // requires measuring glyph metrics, which we can't do at SVG-string time
  // (no DOM). Fall back to 12 user units for v1 — TODO: revisit when we
  // have a layout pass with measurement hooks.
  const fontSize =
    s.fontSize && s.fontSize > 0 ? s.fontSize : 12;
  const fontFamily = s.fontName && s.fontName.length > 0 ? s.fontName : "sans-serif";
  const fill = colorToCss(s.textColor, "rgb(0,0,0)");

  const body = expressionToString(s.textString);

  // We're inside the root `scale(1,-1)` group, so a naive `<text>` would
  // render upside-down. The matrix below is the standard flipped-frame
  // text idiom: `matrix(1 0 0 -1 0 2*yPos)` sends point (px, py) to
  // (px, -py + 2*yPos). The text reference at (xPos, yPos) maps back to
  // (xPos, yPos) — position preserved — but the glyph y-axis is locally
  // inverted so the glyphs read upright after the outer flip.
  return [
    `<text x="${xPos}" y="${yPos}"`,
    ` font-family="${escapeAttr(fontFamily)}"`,
    ` font-size="${fontSize}"`,
    ` fill="${fill}"`,
    ` text-anchor="${textAnchor}"`,
    ` dominant-baseline="middle"`,
    ` transform="matrix(1 0 0 -1 0 ${2 * yPos})"`,
    `>`,
    escapeText(body),
    `</text>`,
  ].join("");
}

// ---- bitmap ----

function renderBitmap(s: BitmapShape): string {
  const { x, y, width, height } = extentToRect(s.extent);
  const href = resolveBitmapHref(s);
  if (!href) return "";
  // SVG <image> renders upside-down under the root scale(1,-1) — apply
  // the same flipped-frame matrix idiom we use for <text>. The bitmap's
  // top-left is at (x, y+height) in local coords; after the matrix the
  // image draws right-side-up while occupying the same extent box.
  const cy = y + height / 2;
  return `<image x="${x}" y="${y}" width="${width}" height="${height}" href="${escapeAttr(href)}" transform="matrix(1 0 0 -1 0 ${2 * cy})"/>`;
}

function resolveBitmapHref(s: BitmapShape): string | undefined {
  const src = s.imageSource;
  if (typeof src === "string" && src.length > 0) {
    if (src.startsWith("data:")) return src;
    // Detect raw base64 PNG signature so the consumer doesn't have to
    // pre-wrap the producer's output. PNG base64 always starts `iVBOR`.
    if (src.startsWith("iVBOR")) return `data:image/png;base64,${src}`;
    return src;
  }
  if (typeof s.fileName === "string" && s.fileName.length > 0) {
    return s.fileName;
  }
  return undefined;
}

// ---------- shared helpers ----------

function pointsToAttr(points: ReadonlyArray<readonly [number, number]>): string {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}

interface RectBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Convert a Modelica `extent` (two corners — possibly in either order)
 * into a `<rect>`-compatible top-left + width/height box. We compute
 * `min`/`max` defensively because OMC sometimes emits `[[50,-50],[-50,50]]`.
 */
function extentToRect(extent: Extent): RectBox {
  const [[x1, y1], [x2, y2]] = extent;
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Re-export Color so callers building shapes inline don't have to dive
// into ./types just for the triple alias.
export type { Color };
