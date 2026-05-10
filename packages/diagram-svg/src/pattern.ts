/**
 * Modelica `LinePattern` and `FillPattern` to CSS / SVG mappings.
 *
 * Modelica enumerates these in `Modelica.Mechanics.MultiBody.Types` and
 * elsewhere; the OMC scripting API stringifies them to the enum literal
 * name (e.g. `"Solid"`, `"Dash"`). We keep the lookup table small — the
 * exotic fill patterns (Hatch, Cross, Sphere, Cylinder) need SVG `<pattern>`
 * defs to render faithfully and are out of scope for v1.
 */

/**
 * Map a Modelica `LinePattern` enum literal to an SVG `stroke-dasharray`
 * value, or `undefined` for `"Solid"` / unspecified (caller should omit
 * the attribute entirely so the SVG default applies).
 *
 * `"None"` returns `"0 1"` so the stroke renders effectively invisible
 * without forcing the caller to special-case `stroke="none"` ergonomically;
 * callers that prefer hiding the stroke can check for `"None"` themselves.
 */
export function linePatternToDashArray(
  pattern?: string,
): string | undefined {
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
 * Translate a Modelica `FillPattern` literal into the `fill` attribute we
 * should emit. The renderer passes in the resolved fill color (already a
 * CSS string) and we either return it untouched (Solid / unspecified) or
 * `"none"` for `"None"`.
 *
 * TODO: Hatch / CrossDiag / HorizontalCylinder / VerticalCylinder /
 * Sphere need SVG `<pattern>` / radial-gradient defs to render. Skipped
 * for v1; callers get the solid fill until then.
 */
export function fillPatternToFill(
  fillCss: string,
  pattern?: string,
): string {
  if (pattern === "None") return "none";
  return fillCss;
}
