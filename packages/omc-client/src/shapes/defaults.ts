/**
 * The Modelica §18.6 graphical-annotation defaults, grouped by the record that
 * declares them. They live beside the schemas and the decoder because that is
 * what defines these records; three consumers in two packages read them.
 *
 * Each answers "what does an unset field mean", but each does something
 * different with the answer: the diff normalizes both sides of a comparison so
 * a field OMC materialized compares equal to one the webview omitted, the
 * properties panel offers one as a field's reset target, and the renderer needs
 * a concrete value to draw. Transcribing them per consumer is what drifts, and
 * `fillColor` did.
 *
 * Reachable from a webview bundle via the `@dicode/omc-client/shapes` subpath,
 * so this module must stay free of the OMC transport — types only.
 *
 * Where a consumer needs something other than the spec value it says so at the
 * point of use. `Text.textColor` is the one that does: OMC reports it unset as
 * a sentinel rather than as the §18.6 default.
 */

import type { Color, Point } from "../_shared/diagramLayout.js";

/** §18.6.5.2 `GraphicItem`. `origin` is not exposed by the properties panel. */
export const GRAPHIC_ITEM_DEFAULTS: {
  visible: boolean;
  origin: Point;
  rotation: number;
} = { visible: true, origin: [0, 0], rotation: 0 };

/** §18.6.5.4 `FilledShape`. Both colors are Black, not blue. */
export const FILLED_SHAPE_DEFAULTS: {
  lineColor: Color;
  fillColor: Color;
  pattern: string;
  fillPattern: string;
  lineThickness: number;
} = {
  lineColor: [0, 0, 0],
  fillColor: [0, 0, 0],
  pattern: "Solid",
  fillPattern: "None",
  lineThickness: 0.25,
};

/** §18.6.5.5 `Line`, which extends `GraphicItem` only. */
export const LINE_DEFAULTS: {
  color: Color;
  pattern: string;
  thickness: number;
  arrow: [string, string];
  arrowSize: number;
  smooth: string;
} = {
  color: [0, 0, 0],
  pattern: "Solid",
  thickness: 0.25,
  arrow: ["None", "None"],
  arrowSize: 3,
  smooth: "None",
};

/** §18.6.5.5 `Polygon`. */
export const POLYGON_DEFAULTS: { smooth: string } = { smooth: "None" };

/** §18.6.5.5 `Rectangle`. */
export const RECTANGLE_DEFAULTS: { borderPattern: string; radius: number } = {
  borderPattern: "None",
  radius: 0,
};

/** §18.6.5.5 `Ellipse`, excluding the derived `closure`. */
export const ELLIPSE_DEFAULTS: { startAngle: number; endAngle: number } = {
  startAngle: 0,
  endAngle: 360,
};

/**
 * §18.6.5.5 `Text`. `textColor` is the spec value; the diff normalizes an
 * absent one to OMC's unset sentinel instead.
 */
export const TEXT_DEFAULTS: {
  textString: string;
  fontName: string;
  fontSize: number;
  textColor: Color;
  textStyle: string[];
  horizontalAlignment: string;
} = {
  textString: "",
  fontName: "",
  fontSize: 0,
  textColor: [0, 0, 0],
  textStyle: [],
  horizontalAlignment: "Center",
};

/** §18.6.5.6 `Bitmap`. */
export const BITMAP_DEFAULTS: { fileName: string; imageSource: string } = {
  fileName: "",
  imageSource: "",
};

/**
 * §18.6.5.5: `Chord` for a full ellipse, `Radial` for an arc. The one default
 * the spec derives rather than states, so it cannot live in the table above.
 */
export function defaultEllipseClosure(shape: {
  startAngle?: number | undefined;
  endAngle?: number | undefined;
}): string {
  const { startAngle, endAngle } = ELLIPSE_DEFAULTS;
  return (shape.startAngle ?? startAngle) === startAngle &&
    (shape.endAngle ?? endAngle) === endAngle
    ? "Chord"
    : "Radial";
}
