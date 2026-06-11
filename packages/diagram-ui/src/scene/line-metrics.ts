/**
 * Pure line-metric math shared by the GreasedLine stroke/edge builders.
 * No Babylon, no DOM — maps between world-space geometry and the
 * screen-space quantities the renderer needs (stroke width, dash count).
 */

/**
 * Diagram (world) units covered by one device pixel, given the
 * orthographic camera's horizontal extent and the canvas width. The
 * scene's camera is orthographic, so this ratio is uniform across the
 * viewport and is the bridge between screen-pixel sizing and world
 * geometry. A degenerate extent or canvas collapses to `1` so callers
 * never divide by zero.
 */
export function worldPerPixel(
  orthoLeft: number,
  orthoRight: number,
  canvasWidth: number,
): number {
  const extent = orthoRight - orthoLeft;
  if (!(extent > 0) || !(canvasWidth > 0)) {
    return 1;
  }
  return extent / canvasWidth;
}

/** Total length of a polyline in the same units as its points. */
export function polylineLength(
  points: ReadonlyArray<readonly [number, number]>,
): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) {
      continue;
    }
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
}

/**
 * Number of dash periods along a polyline so that one period spans a
 * constant `periodPx` device pixels regardless of zoom. GreasedLine's
 * `dashCount` is the count across the whole (normalized) line, so it
 * tracks the line's on-screen length: `lengthPx / periodPx`, where
 * `lengthPx = worldLength / worldPerPixel`. Clamped to at least `1` so
 * a very short or zoomed-out line still shows a single dash rather than
 * collapsing to a solid stroke.
 */
export function screenDashCount(
  worldLength: number,
  worldPerPixelRatio: number,
  periodPx: number,
): number {
  if (!(worldLength > 0) || !(worldPerPixelRatio > 0) || !(periodPx > 0)) {
    return 1;
  }
  const lengthPx = worldLength / worldPerPixelRatio;
  return Math.max(1, Math.round(lengthPx / periodPx));
}

/**
 * Spec-default Modelica stroke width in icon units when an annotation
 * omits `lineThickness`. Mirrors `@dicode/diagram-svg`'s
 * `SPEC_DEFAULT_THICKNESS` (the bare `0.25` spec default lifted to stay
 * legible) so SVG and Babylon strokes carry the same weight.
 */
export const SPEC_DEFAULT_THICKNESS = 0.25 * 5;

/**
 * Default `lineThicknessScale` multiplier, matching
 * `@dicode/diagram-svg`'s `DEFAULT_LINE_THICKNESS_SCALE`. Applied when
 * the host doesn't pass an explicit scale.
 */
export const DEFAULT_LINE_THICKNESS_SCALE = 10;

/**
 * Screen-space dash rhythm for a Modelica line `pattern`. `periodPx` is
 * the on-screen length of one dash+gap cycle; `ratio` is the fraction
 * of that cycle left empty (GreasedLine's `dashRatio`: 0.5 = half drawn,
 * half gap). Returns `null` for solid patterns (`"Solid"`, `"None"`,
 * unset) so the caller renders an undashed stroke.
 */
export function dashStyleForPattern(
  pattern: string | undefined,
): { periodPx: number; ratio: number } | null {
  switch (pattern) {
    case "Dash":
      return { periodPx: 12, ratio: 0.4 };
    case "Dot":
      return { periodPx: 6, ratio: 0.7 };
    case "DashDot":
      return { periodPx: 16, ratio: 0.45 };
    case "DashDotDot":
      return { periodPx: 20, ratio: 0.5 };
    default:
      return null;
  }
}

/**
 * Resolve a stroke's world-space width from a Modelica `lineThickness`
 * (icon units) and the host's `lineThicknessScale`. An omitted
 * thickness falls back to {@link SPEC_DEFAULT_THICKNESS}; an omitted or
 * non-positive scale falls back to {@link DEFAULT_LINE_THICKNESS_SCALE}.
 * Tracks `scaledThickness` in `@dicode/diagram-svg`, with the added guard
 * that a non-positive scale resolves to the default rather than collapsing
 * the stroke to zero width.
 */
export function strokeWorldWidth(
  thickness: number | undefined,
  thicknessScale: number | undefined,
): number {
  const base = thickness ?? SPEC_DEFAULT_THICKNESS;
  const scale =
    thicknessScale !== undefined && thicknessScale > 0
      ? thicknessScale
      : DEFAULT_LINE_THICKNESS_SCALE;
  return base * scale;
}
