/**
 * Pure sizing rules for `<om-text>`, kept apart from the component so the
 * fit and resolution math runs (and tests) without a canvas or renderer.
 */

/**
 * Em-size vs visual-height compensation, applied in two places by
 * `<om-text>`:
 *
 * - Every explicitly stated `fontSize`: a `font-size: Npx` font's em box
 *   is taller than its visible cap height, so drawing the stated size raw
 *   renders larger than the same size in other Modelica tools; the
 *   multiply brings the visual height back in line.
 * - The auto-fit fallback (`fontSize == 0` with no measurable 2D canvas,
 *   e.g. headless): the extent height stands in for the measurement, and
 *   the same factor keeps the glyph from overshooting the box. When
 *   measurement is available, {@link fitFontSize} replaces this fallback.
 */
export const FONT_FIT_FACTOR = 0.7;

/** Font size a string is measured at. Glyph metrics scale linearly with
 *  font size, so any comfortable value works; a large one keeps the
 *  measured ratios away from sub-pixel rounding. */
export const TRIAL_FONT_SIZE = 100;

/**
 * Font size that fits a string measured at `trialSize`
 * (`measuredWidth`/`measuredHeight`) into a `boxWidth` × `boxHeight`
 * extent — Modelica `fontSize == 0` (§18.6.5.5: scale the text to fit the
 * extent). Both dimensions constrain and the smaller ratio wins, so the
 * glyph aspect ratio is preserved (never stretched non-uniformly) and a
 * long string shrinks instead of overflowing the box. Returns `null` when
 * any input is degenerate (non-positive or non-finite) — callers fall back
 * to the {@link FONT_FIT_FACTOR} heuristic.
 */
export function fitFontSize(
  boxWidth: number,
  boxHeight: number,
  measuredWidth: number,
  measuredHeight: number,
  trialSize: number = TRIAL_FONT_SIZE,
): number | null {
  if (!isPositive(boxWidth) || !isPositive(boxHeight)) return null;
  if (!isPositive(measuredWidth) || !isPositive(measuredHeight)) return null;
  if (!isPositive(trialSize)) return null;
  const scale = Math.min(boxWidth / measuredWidth, boxHeight / measuredHeight);
  return trialSize * scale;
}

function isPositive(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

/** Floor on the `Text` resolution: an eighth of the glyph's local size.
 *  Deep zoom-out re-rasterizes toward the on-screen size instead of
 *  minifying a full-size atlas (Pixi text has no mip chain); past the
 *  floor the label is a few pixels tall and detail is gone anyway. */
export const MIN_TEXT_RESOLUTION = 0.125;
/** Ceiling on the `Text` resolution. Caps glyph-atlas allocation on deep
 *  zoom; a label gains nothing visible past this density. */
export const MAX_TEXT_RESOLUTION = 8;

/**
 * `Text.resolution` target for an on-screen texel density (device pixels
 * per text-local unit) — followed on zoom in BOTH directions. Always
 * rounds up so the atlas never samples above its rasterized size: whole
 * steps above `1` (crisp, and the quantization bounds rebuild churn),
 * power-of-two steps below `1` (heavy minification re-rasterizes near the
 * rendered size). Clamped to
 * [{@link MIN_TEXT_RESOLUTION}, {@link MAX_TEXT_RESOLUTION}]; a degenerate
 * density yields the neutral `1`.
 */
export function quantizeTextResolution(density: number): number {
  if (!Number.isFinite(density) || density <= 0) return 1;
  if (density >= 1) return Math.min(MAX_TEXT_RESOLUTION, Math.ceil(density));
  return Math.max(MIN_TEXT_RESOLUTION, 2 ** Math.ceil(Math.log2(density)));
}
