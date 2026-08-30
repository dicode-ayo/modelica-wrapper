/**
 * Renderer-neutral resolution of a Modelica `FillPattern` into a structural
 * description both the SVG and the Babylon/GL renderers consume, so the two
 * cannot drift on gradient axes, stop colors, or hatch geometry.
 *
 * Modelica's `FillPattern` (§18.6.5) divides into three regimes:
 *  - `None` / `Solid` / unknown → a flat fill (or nothing).
 *  - `HorizontalCylinder` / `VerticalCylinder` / `Sphere` → a gradient between
 *    `fillColor` and `lineColor`.
 *  - `Horizontal` / `Vertical` / `Cross` / `Forward` / `Backward` /
 *    `CrossDiag` → a hatch: `lineColor` lines over a `fillColor` background.
 *
 * Color model is `lineColor` ↔ `fillColor` only — no lighten/darken math
 * (matches OMEdit's `ShapeAnnotation.cpp`). When `lineColor` is unset the edge
 * falls back to black, OMEdit's default line color.
 *
 * Coordinates are normalized to a `0..1` bounding box so a single resolved
 * spec serves shapes of any size; the SVG renderer maps them to
 * `objectBoundingBox` gradient units and the GL renderer maps them to UVs.
 */

import type { Color } from "./types.js";

export const DEFAULT_EDGE_COLOR: Color = [0, 0, 0];

/** A gradient color stop. `offset` is `0..1` along the gradient axis. */
export interface FillStop {
  offset: number;
  color: Color;
}

/**
 * Linear gradient along the segment `(x1,y1)→(x2,y2)` in normalized bbox
 * coordinates (`0..1`, y-down). `HorizontalCylinder` shades top→bottom;
 * `VerticalCylinder` shades left→right.
 */
export interface LinearGradientSpec {
  kind: "linear-gradient";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: FillStop[];
}

/**
 * Radial gradient centered at `(cx,cy)` with radius `r` in normalized bbox
 * coordinates. `Sphere` shades `fillColor` at the center → `lineColor` at the
 * rim.
 */
export interface RadialGradientSpec {
  kind: "radial-gradient";
  cx: number;
  cy: number;
  r: number;
  stops: FillStop[];
}

export type HatchDirection =
  "horizontal" | "vertical" | "forward" | "backward" | "cross" | "cross-diag";

/**
 * Hatch: `line` lines of the given `direction` over a `background` fill.
 * `spacing` and `lineWidth` are in icon units (the shared fixed geometry
 * both renderers tile/stroke with).
 */
export interface HatchSpec {
  kind: "hatch";
  direction: HatchDirection;
  line: Color;
  background: Color;
  spacing: number;
  lineWidth: number;
}

/** Flat fill in a single `color`. */
export interface SolidFillSpec {
  kind: "solid";
  color: Color;
}

export interface NoneFillSpec {
  kind: "none";
}

export type FillSpec =
  | SolidFillSpec
  | NoneFillSpec
  | LinearGradientSpec
  | RadialGradientSpec
  | HatchSpec;

/** Fixed hatch geometry — MSL hatches render poorly at small icon sizes, so a
 *  fixed spacing keeps sub-component icons legible rather than scaling with
 *  the shape. */
export const HATCH_SPACING = 6;
export const HATCH_LINE_WIDTH = 1;

/**
 * Resolve a Modelica `FillPattern` plus its `fillColor` / `lineColor` into a
 * renderer-neutral `FillSpec`. Pure — no DOM, no Babylon.
 */
export function fillSpec(opts: {
  fillColor: Color | undefined;
  lineColor: Color | undefined;
  pattern: string | undefined;
}): FillSpec {
  const { fillColor, lineColor, pattern } = opts;

  if (pattern === "None") return { kind: "none" };

  const gradient = gradientKindFor(pattern);
  if (gradient) {
    // A gradient with no fillColor has nothing to shade — draw nothing.
    if (!isColor(fillColor)) return { kind: "none" };
    const edge = isColor(lineColor) ? lineColor : DEFAULT_EDGE_COLOR;
    return gradientSpec(gradient, fillColor, edge);
  }

  const hatch = hatchDirectionFor(pattern);
  if (hatch) {
    if (!isColor(fillColor)) return { kind: "none" };
    const line = isColor(lineColor) ? lineColor : DEFAULT_EDGE_COLOR;
    return {
      kind: "hatch",
      direction: hatch,
      line,
      background: fillColor,
      spacing: HATCH_SPACING,
      lineWidth: HATCH_LINE_WIDTH,
    };
  }

  if (!isColor(fillColor)) return { kind: "none" };
  return { kind: "solid", color: fillColor };
}

type GradientKind = "hcyl" | "vcyl" | "sphere";

function gradientKindFor(
  pattern: string | undefined,
): GradientKind | undefined {
  switch (pattern) {
    case "HorizontalCylinder":
      return "hcyl";
    case "VerticalCylinder":
      return "vcyl";
    case "Sphere":
      return "sphere";
    default:
      return undefined;
  }
}

function hatchDirectionFor(
  pattern: string | undefined,
): HatchDirection | undefined {
  switch (pattern) {
    case "Horizontal":
      return "horizontal";
    case "Vertical":
      return "vertical";
    case "Cross":
      return "cross";
    case "Forward":
      return "forward";
    case "Backward":
      return "backward";
    case "CrossDiag":
      return "cross-diag";
    default:
      return undefined;
  }
}

function gradientSpec(
  kind: GradientKind,
  fill: Color,
  edge: Color,
): LinearGradientSpec | RadialGradientSpec {
  if (kind === "sphere") {
    return {
      kind: "radial-gradient",
      cx: 0.5,
      cy: 0.5,
      r: 0.5,
      stops: [
        { offset: 0, color: fill },
        { offset: 1, color: edge },
      ],
    };
  }
  const [x1, y1, x2, y2] = kind === "hcyl" ? [0, 0, 0, 1] : [0, 0, 1, 0];
  return {
    kind: "linear-gradient",
    x1,
    y1,
    x2,
    y2,
    stops: [
      { offset: 0, color: edge },
      { offset: 0.5, color: fill },
      { offset: 1, color: edge },
    ],
  };
}

function isColor(c: Color | undefined): c is Color {
  return Array.isArray(c) && c.length === 3;
}
