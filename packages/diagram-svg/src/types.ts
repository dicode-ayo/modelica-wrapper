/**
 * Re-exports of the diagram-layout types produced by
 * `@dicode/omc-client`'s DiagramLayout producer
 * (`packages/omc-client/src/_shared/diagramLayout.ts`).
 *
 * Centralized here so the rest of this package can import shape
 * primitives, layer/class types, and the Expression sub-tree it needs
 * for `Text.textString` resolution from a single seam.
 */

export type {
  // primitives
  Point,
  Extent,
  Color,
  // expression sub-tree (used by Text.textString)
  Expression,
  ComponentRef,
  ComponentRefPart,
  CallExpr,
  EnumLiteral,
  BinaryOpExpr,
  UnaryOpExpr,
  // shapes
  LineShape,
  PolygonShape,
  RectangleShape,
  EllipseShape,
  TextShape,
  BitmapShape,
  Shape,
  // layers / classes
  IconLayer,
  ClassDef,
  CoordinateSystem,
} from "@dicode/omc-client";
