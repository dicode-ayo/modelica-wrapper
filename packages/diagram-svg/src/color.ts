/**
 * Color helpers and the `borderPattern` bevel rule, shared by the SVG
 * renderer and `@dicode/diagram-ui`'s canvas primitives.
 *
 * Modelica annotations represent colors as `[r, g, b]` triples in the
 * `0..255` range. We map them to a CSS `rgb(...)` string. Anything missing
 * or malformed falls back to the supplied `fallback` (default `transparent`).
 */

import { FILLED_SHAPE_DEFAULTS } from "@dicode/omc-client/shapes";

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
 * with exactly that palette. `lighter` scales HSV Value; `darker` divides
 * each RGB channel, which is the same as halving Value. A black face
 * yields black on both edges, matching Qt.
 */
export function bevelColors(face: Color): { light: Color; dark: Color } {
  const [r, g, b] = face;
  return {
    light: qtLighter150(face),
    dark: [clampByte(r / 2), clampByte(g / 2), clampByte(b / 2)],
  };
}

/**
 * Qt `QColor::lighter(150)`: scale HSV Value by 1.5, and when Value
 * overflows full brightness the excess drains out of Saturation — so a
 * fully saturated primary lightens toward white (pure red → pink) instead
 * of clipping each channel back onto the face color, which would leave
 * the bevel's light edge invisible.
 */
function qtLighter150(face: Color): Color {
  const r = clampByte(face[0]);
  const g = clampByte(face[1]);
  const b = clampByte(face[2]);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let v = (max / 255) * 1.5;
  let s = max === 0 ? 0 : d / max;
  if (v > 1) {
    s = Math.max(0, s - (v - 1));
    v = 1;
  }
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  const c = v * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = v - c;
  const sector: [number, number, number] =
    h < 1
      ? [c, x, 0]
      : h < 2
        ? [x, c, 0]
        : h < 3
          ? [0, c, x]
          : h < 4
            ? [0, x, c]
            : h < 5
              ? [x, 0, c]
              : [c, 0, x];
  return [
    clampByte((sector[0] + m) * 255),
    clampByte((sector[1] + m) * 255),
    clampByte((sector[2] + m) * 255),
  ];
}

/** One bevel edge: the polyline tracing it and the tone it strokes in. */
export interface BevelEdge {
  points: ReadonlyArray<readonly [number, number]>;
  color: Color;
}

/**
 * Geometry + tone decision for a `Rectangle.borderPattern` bevel — the
 * `qDrawShadePanel` look OMEdit draws — decided once for both renderers:
 * §18.6.5.5's `Raised`/`Sunken`/`Engraved` ask for a shaded bevel, not an
 * outline, so callers draw these two polylines INSTEAD of the `lineColor`
 * stroke. `Raised` is light top/left + dark bottom/right, `Sunken` the
 * inverse, and `Engraved` collapses to the sunken tones — Qt's etched
 * double frame is a one-pixel detail below what an icon resolves at
 * typical zoom. `"None"` and unknown values return `null`; the caller
 * keeps its normal outline. A missing face color falls back to the §18.6
 * `fillColor` default.
 *
 * The box's max-`y` edge is the screen-top: diagram space is y-up and both
 * renderers draw under a root Y-flip.
 */
export function bevelEdges(
  box: { x: number; y: number; width: number; height: number },
  borderPattern: string | undefined,
  face: Color | undefined,
): { topLeft: BevelEdge; bottomRight: BevelEdge } | null {
  if (
    borderPattern !== "Raised" &&
    borderPattern !== "Sunken" &&
    borderPattern !== "Engraved"
  ) {
    return null;
  }
  const { light, dark } = bevelColors(face ?? FILLED_SHAPE_DEFAULTS.fillColor);
  const raised = borderPattern === "Raised";
  const { x, y, width, height } = box;
  return {
    topLeft: {
      points: [
        [x, y],
        [x, y + height],
        [x + width, y + height],
      ],
      color: raised ? light : dark,
    },
    bottomRight: {
      points: [
        [x + width, y + height],
        [x + width, y],
        [x, y],
      ],
      color: raised ? dark : light,
    },
  };
}
