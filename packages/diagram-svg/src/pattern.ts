/**
 * Modelica `LinePattern` and `FillPattern` to CSS / SVG mappings.
 *
 * `LinePattern` straightforwardly maps to `stroke-dasharray`.
 *
 * `FillPattern` divides into two regimes:
 *  - Solid / None / unknown → plain `fill` value (an `rgb(...)` color or `none`).
 *  - HorizontalCylinder / VerticalCylinder / Sphere → SVG gradient. We emit
 *    one `<linearGradient>` / `<radialGradient>` def per unique
 *    (kind, edge color, middle color) tuple, keyed by a deterministic id so
 *    Chromatic snapshots stay stable across runs and so identical fills on
 *    multiple shapes share one def.
 *
 * The remaining FillPattern values (Horizontal / Vertical / Cross / Forward /
 * Backward / CrossDiag) are hatch patterns that need SVG `<pattern>` tiles —
 * skipped for v1; callers get the solid fill until they're implemented.
 */

import type { Color } from "./types.js";
import { colorToCss } from "./color.js";

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
 * caller must include the gradient XML in the SVG's `<defs>` block exactly
 * once per `def.id` (multiple shapes sharing the same fill share a def).
 */
export interface ResolvedFill {
  value: string;
  def?: { id: string; xml: string };
}

/**
 * Resolve a Modelica `FillPattern` (with the resolved fillColor / lineColor)
 * into a fill attribute value + an optional gradient def. Used for
 * rectangle / polygon / ellipse — anything that takes a `FilledShape` block
 * in Modelica's §18.6 spec.
 *
 * Gradient stops:
 *  - HorizontalCylinder: linear gradient on the y-axis (top→middle→bottom),
 *    stops [lineColor, fillColor, lineColor]. Cylinder lies horizontally,
 *    so shading varies vertically — matches OMEdit's rendering of the
 *    typical Inertia / SpringDamper rectangles.
 *  - VerticalCylinder: linear gradient on the x-axis.
 *  - Sphere: radial gradient, fillColor at center, lineColor at edge.
 *
 * When `lineColor` is unset we fall back to a darkened fillColor so the
 * gradient still has visible contrast. When both are unset we still produce
 * a "none" fill — there's nothing to draw.
 */
export function resolveFill(opts: {
  fillColor: Color | undefined;
  lineColor: Color | undefined;
  pattern: string | undefined;
}): ResolvedFill {
  const { fillColor, lineColor, pattern } = opts;

  if (pattern === "None") return { value: "none" };

  const fillCss = colorToCss(fillColor, "none");
  const kind = gradientKindFor(pattern);
  if (!kind) return { value: fillCss };

  // If there's no fillColor at all, the gradient has nothing meaningful to
  // shade — fall through to whatever the solid path would emit ("none").
  if (fillCss === "none") return { value: "none" };

  const edge = colorToCss(lineColor, darkenedFallback(fillColor));
  const id = makeGradientId(kind, edge, fillCss);
  const xml = buildGradientXml(id, kind, edge, fillCss);
  return { value: `url(#${id})`, def: { id, xml } };
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

/**
 * Build a stable, descriptive gradient id. Deterministic so identical
 * (kind, edge, middle) tuples collapse to one def across the whole SVG.
 * The leading `dsvg-` prefix scopes our ids to this renderer in case the
 * SVG ends up inlined alongside other gradient-using markup.
 */
function makeGradientId(
  kind: GradientKind,
  edge: string,
  middle: string,
): string {
  const slug = (s: string) => s.replace(/[^0-9A-Za-z]/g, "");
  return `dsvg-${kind}-${slug(edge)}-${slug(middle)}`;
}

function buildGradientXml(
  id: string,
  kind: GradientKind,
  edge: string,
  middle: string,
): string {
  if (kind === "sphere") {
    return [
      `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5">`,
      `<stop offset="0%" stop-color="${middle}"/>`,
      `<stop offset="100%" stop-color="${edge}"/>`,
      `</radialGradient>`,
    ].join("");
  }
  // hcyl = vertical gradient (top→bottom); vcyl = horizontal (left→right).
  // Default gradientUnits is `objectBoundingBox` so coords are 0..1 in the
  // shape's bbox and one def can serve many shapes.
  const [x1, y1, x2, y2] = kind === "hcyl" ? [0, 0, 0, 1] : [0, 0, 1, 0];
  return [
    `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">`,
    `<stop offset="0%" stop-color="${edge}"/>`,
    `<stop offset="50%" stop-color="${middle}"/>`,
    `<stop offset="100%" stop-color="${edge}"/>`,
    `</linearGradient>`,
  ].join("");
}

/**
 * Derive an edge color when `lineColor` is unset. We darken the fillColor
 * toward black by 50% so the gradient still has contrast at the edges.
 * Picked to give a reasonable cylinder look on a typical light-gray fill
 * without veering toward pure black on already-dark fills.
 */
function darkenedFallback(fillColor: Color | undefined): string {
  if (!fillColor) return "rgb(0,0,0)";
  const [r, g, b] = fillColor;
  const k = 0.5;
  const darker: Color = [
    Math.max(0, Math.round(r * k)),
    Math.max(0, Math.round(g * k)),
    Math.max(0, Math.round(b * k)),
  ];
  return colorToCss(darker, "rgb(0,0,0)");
}

/**
 * @deprecated Kept for the small number of internal callers that haven't
 * been migrated to `resolveFill`. New code should use `resolveFill` so
 * gradient defs get collected and emitted in `<defs>`.
 */
export function fillPatternToFill(fillCss: string, pattern?: string): string {
  if (pattern === "None") return "none";
  return fillCss;
}
