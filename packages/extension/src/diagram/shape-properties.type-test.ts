import type {
  EllipseShape,
  LineShape,
  PolygonShape,
  RectangleShape,
  Shape,
} from "@dicode/omc-client";

import type { FilledShapeField, ShapeField } from "./shape-properties.js";

// The probes are exported because `noUnusedLocals` would otherwise report each
// one as unused, and that error alone would satisfy its `@ts-expect-error`.

/** Compiles only when `Field` is assignable to `Target`. */
type Fits<Target, Field extends Target> = Field;

type AnyKind = ShapeField<Shape>;
type Filled = FilledShapeField;
type Line = ShapeField<LineShape>;
type Polygon = ShapeField<PolygonShape>;
type Rectangle = ShapeField<RectangleShape>;
type Ellipse = ShapeField<EllipseShape>;

export type GraphicItemFitsLine = Fits<Line, AnyKind>;
export type FilledFitsPolygon = Fits<Polygon, Filled>;
export type FilledFitsRectangle = Fits<Rectangle, Filled>;
export type FilledFitsEllipse = Fits<Ellipse, Filled>;

// A shared group spreads into every kind that carries it, so a field declared
// for one kind must not fit there. Method syntax would make S bivariant and
// let both through.
// @ts-expect-error a Line field must not join the all-kinds group
export type LineFitsAnyKind = Fits<AnyKind, Line>;
// @ts-expect-error a Polygon field must not join the filled group
export type PolygonFitsFilled = Fits<Filled, Polygon>;

// Declared over the all-optional `FilledShape` record, the filled group would
// accept a `LineShape` and write `lineColor` onto a Modelica `Line`.
// @ts-expect-error the filled group must not fit a Line's field list
export type FilledFitsLine = Fits<Line, Filled>;
