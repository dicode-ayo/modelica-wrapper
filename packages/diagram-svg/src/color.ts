/**
 * Color helpers for the SVG renderer.
 *
 * Modelica annotations represent colors as `[r, g, b]` triples in the
 * `0..255` range. We map them to a CSS `rgb(...)` string. Anything missing
 * or malformed falls back to the supplied `fallback` (default `transparent`).
 */

import type { Color } from "./types.js";

/**
 * Convert a Modelica `[r,g,b]` color to a CSS color string, clamping each
 * channel to `0..255` and rounding to integers. `undefined` returns the
 * fallback so callers can chain `colorToCss(shape.fillColor, "none")` to
 * turn a missing color into a no-fill.
 */
export function colorToCss(
  color: Color | undefined,
  fallback = "transparent",
): string {
  if (!color || color.length !== 3) return fallback;
  const [r, g, b] = color;
  return `rgb(${clampByte(r)},${clampByte(g)},${clampByte(b)})`;
}

/** Clamp a color channel to an integer in `0..255`; non-finite → `0`. */
export function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 255) return 255;
  return Math.round(n);
}

/**
 * Light / dark edge tones for a `Rectangle.borderPattern` bevel, derived
 * from the face (fill) color with Qt's palette factors — `lighter(150)` /
 * `darker(200)` — because OMEdit draws these bevels via `qDrawShadePanel`
 * with exactly that palette. A black face yields black on both edges,
 * matching Qt.
 */
export function bevelColors(face: Color): { light: Color; dark: Color } {
  const [r, g, b] = face;
  return {
    light: [clampByte(r * 1.5), clampByte(g * 1.5), clampByte(b * 1.5)],
    dark: [clampByte(r / 2), clampByte(g / 2), clampByte(b / 2)],
  };
}
