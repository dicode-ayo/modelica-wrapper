/**
 * Modelica `LinePattern` and `FillPattern` to CSS / SVG mappings.
 *
 * `LinePattern` straightforwardly maps to `stroke-dasharray`.
 *
 * `FillPattern` is resolved by the renderer-neutral `fillSpec` helper
 * (`fill-spec.ts`); this module maps that spec to the SVG attribute regime:
 *  - Solid / None / unknown → plain `fill` value (an `rgb(...)` color or
 *    `none`).
 *  - HorizontalCylinder / VerticalCylinder / Sphere → an SVG gradient def.
 *  - Horizontal / Vertical / Cross / Forward / Backward / CrossDiag → an SVG
 *    `<pattern>` tile.
 *
 * One `<linearGradient>` / `<radialGradient>` / `<pattern>` def is emitted per
 * unique fill, keyed by a deterministic id so Chromatic snapshots stay stable
 * and identical fills on multiple shapes share one def.
 */

import type { Color } from "./types.js";
import { colorToCss } from "./color.js";
import { fillSpec, type FillSpec } from "./fill-spec.js";

/**
 * Map a Modelica `LinePattern` enum literal to an SVG `stroke-dasharray`
 * value, or `undefined` for `"Solid"` / unspecified (caller should omit
 * the attribute entirely so the SVG default applies).
 *
 * `"None"` returns `"0 1"` so the stroke renders effectively invisible
 * without forcing the caller to special-case `stroke="none"` ergonomically;
 * callers that prefer hiding the stroke can check for `"None"` themselves.
 */
export function linePatternToDashArray(pattern?: string): string | undefined {
  switch (pattern) {
    case undefined:
    case "Solid":
      return undefined;
    case "Dash":
      return "8 4";
    case "Dot":
      return "1 4";
    case "DashDot":
      return "8 4 1 4";
    case "DashDotDot":
      return "8 4 1 4 1 4";
    case "None":
      return "0 1";
    default:
      // Unknown enum value — be lenient, treat as solid.
      return undefined;
  }
}

/**
 * Result of resolving a Modelica fill pattern. `value` is the string that
 * should go into the SVG `fill="..."` attribute; if `def` is present, the
 * caller must include the def XML in the SVG's `<defs>` block exactly once
 * per `def.id` (multiple shapes sharing the same fill share a def).
 */
export interface ResolvedFill {
  value: string;
  def?: { id: string; xml: string };
}

type LinearGradientSpec = Extract<FillSpec, { kind: "linear-gradient" }>;
type RadialGradientSpec = Extract<FillSpec, { kind: "radial-gradient" }>;
type HatchSpec = Extract<FillSpec, { kind: "hatch" }>;

/**
 * Resolve a Modelica `FillPattern` (with the resolved fillColor / lineColor)
 * into a fill attribute value + an optional def. Used for
 * rectangle / polygon / ellipse — anything that takes a `FilledShape` block
 * in Modelica's §18.6 spec.
 */
export function resolveFill(opts: {
  fillColor: Color | undefined;
  lineColor: Color | undefined;
  pattern: string | undefined;
}): ResolvedFill {
  const spec = fillSpec(opts);
  switch (spec.kind) {
    case "none":
      return { value: "none" };
    case "solid":
      return { value: colorToCss(spec.color, "none") };
    case "linear-gradient":
    case "radial-gradient":
    case "hatch": {
      const id = makeFillId(spec);
      const xml = buildFillXml(id, spec);
      return { value: `url(#${id})`, def: { id, xml } };
    }
  }
}

function makeFillId(
  spec: LinearGradientSpec | RadialGradientSpec | HatchSpec,
): string {
  const slug = (s: string) => s.replace(/[^0-9A-Za-z]/g, "");
  if (spec.kind === "hatch") {
    const line = slug(colorToCss(spec.line));
    const bg = slug(colorToCss(spec.background));
    return `dsvg-hatch-${spec.direction}-${line}-${bg}`;
  }
  const kind = gradientIdKind(spec);
  const edge = slug(stopColorAt(spec, "edge"));
  const middle = slug(stopColorAt(spec, "middle"));
  return `dsvg-${kind}-${edge}-${middle}`;
}

function gradientIdKind(
  spec: LinearGradientSpec | RadialGradientSpec,
): "hcyl" | "vcyl" | "sphere" {
  if (spec.kind === "radial-gradient") return "sphere";
  return spec.y2 === 1 ? "hcyl" : "vcyl";
}

/**
 * The cylinder gradient's edge color sits at offset 0/1, its middle color at
 * offset 0.5; the sphere's middle (fillColor) sits at offset 0 (center), its
 * edge (lineColor) at offset 1 (rim).
 */
function stopColorAt(
  spec: LinearGradientSpec | RadialGradientSpec,
  which: "edge" | "middle",
): string {
  if (spec.kind === "radial-gradient") {
    const center = spec.stops[0];
    const rim = spec.stops[1];
    if (center === undefined || rim === undefined) return "none";
    return colorToCss(which === "middle" ? center.color : rim.color);
  }
  const edge = spec.stops[0];
  const middle = spec.stops[1];
  if (edge === undefined || middle === undefined) return "none";
  return colorToCss(which === "edge" ? edge.color : middle.color);
}

function buildFillXml(
  id: string,
  spec: LinearGradientSpec | RadialGradientSpec | HatchSpec,
): string {
  switch (spec.kind) {
    case "radial-gradient":
      return [
        `<radialGradient id="${id}" cx="${spec.cx}" cy="${spec.cy}" r="${spec.r}">`,
        ...spec.stops.map(
          (s) =>
            `<stop offset="${pct(s.offset)}" stop-color="${colorToCss(s.color)}"/>`,
        ),
        `</radialGradient>`,
      ].join("");
    case "linear-gradient":
      return [
        `<linearGradient id="${id}" x1="${spec.x1}" y1="${spec.y1}" x2="${spec.x2}" y2="${spec.y2}">`,
        ...spec.stops.map(
          (s) =>
            `<stop offset="${pct(s.offset)}" stop-color="${colorToCss(s.color)}"/>`,
        ),
        `</linearGradient>`,
      ].join("");
    case "hatch":
      return buildHatchXml(id, spec);
  }
}

function pct(offset: number): string {
  return `${offset * 100}%`;
}

/**
 * A `userSpaceOnUse` `<pattern>` tile holding the hatch's line(s) over a
 * `background` rect. Tile is `spacing × spacing`; lines run edge-to-edge so
 * adjacent tiles connect seamlessly.
 */
function buildHatchXml(id: string, spec: HatchSpec): string {
  const s = spec.spacing;
  const line = colorToCss(spec.line);
  const bg = colorToCss(spec.background);
  const strokes = hatchStrokes(spec.direction, s, line, spec.lineWidth);
  return [
    `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${s}" height="${s}">`,
    `<rect width="${s}" height="${s}" fill="${bg}"/>`,
    ...strokes,
    `</pattern>`,
  ].join("");
}

function hatchStrokes(
  direction: HatchSpec["direction"],
  s: number,
  line: string,
  w: number,
): string[] {
  const stroke = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${line}" stroke-width="${w}"/>`;
  const half = s / 2;
  switch (direction) {
    case "horizontal":
      return [stroke(0, half, s, half)];
    case "vertical":
      return [stroke(half, 0, half, s)];
    case "cross":
      return [stroke(0, half, s, half), stroke(half, 0, half, s)];
    case "forward":
      // Bottom-left → top-right slash; tiles seamlessly across the spacing.
      return [stroke(0, s, s, 0)];
    case "backward":
      return [stroke(0, 0, s, s)];
    case "cross-diag":
      return [stroke(0, s, s, 0), stroke(0, 0, s, s)];
  }
}

/**
 * @deprecated Kept for the small number of internal callers that haven't
 * been migrated to `resolveFill`. New code should use `resolveFill` so
 * gradient / pattern defs get collected and emitted in `<defs>`.
 */
export function fillPatternToFill(fillCss: string, pattern?: string): string {
  if (pattern === "None") return "none";
  return fillCss;
}
