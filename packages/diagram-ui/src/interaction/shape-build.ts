import type { Color, Extent, Point, Shape } from "@dicode/omc-client";

import type { ExtentKind, PolyKind } from "./tools.js";

/**
 * Constructs the `Shape` a draw tool commits. Geometry comes from the
 * gesture; everything else is the default a new primitive is born with.
 */

/** Outline colour a freshly-drawn primitive is created with. Modelica's own
 *  default is a transparent-black `lineColor`, which renders as nothing — a
 *  shape the user just drew has to be visible. */
export const DRAWN_SHAPE_LINE_COLOR: Color = [0, 0, 0];

/** Build a default extent primitive for a freshly-drawn shape. */
export function buildExtentShape(kind: ExtentKind, extent: Extent): Shape {
  return kind === "rectangle"
    ? { kind: "rectangle", extent, lineColor: DRAWN_SHAPE_LINE_COLOR }
    : { kind: "ellipse", extent, lineColor: DRAWN_SHAPE_LINE_COLOR };
}

/**
 * Build a default poly primitive for a freshly-drawn shape. A `line` stays
 * open; a `polygon` is closed by the renderer, so `points` carries only the
 * distinct vertices — no duplicated closing point.
 */
export function buildPolyShape(kind: PolyKind, points: Point[]): Shape {
  return kind === "line"
    ? { kind: "line", points, color: DRAWN_SHAPE_LINE_COLOR }
    : { kind: "polygon", points, lineColor: DRAWN_SHAPE_LINE_COLOR };
}
