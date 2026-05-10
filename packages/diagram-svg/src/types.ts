/**
 * Local mirrors of the diagram-layout types produced by
 * `@modelica-wrapper/omc-client`'s DiagramLayout producer
 * (`packages/omc-client/src/_shared/diagramLayout.ts`).
 *
 * These are STRUCTURALLY equivalent to the producer's types — same field
 * names, same shapes, same Expression union. We keep a local copy because
 * `omc-client` does not yet re-export `IconLayer`/`Shape`/`ClassDef` from
 * its public barrel and the current spec for this package forbids touching
 * `omc-client`. Once those exports are added upstream this file should be
 * replaced with `export type { ... } from "@modelica-wrapper/omc-client";`
 * — there is intentionally no runtime here, just type aliases, so the swap
 * is mechanical.
 *
 * If the producer's types drift, this file is the seam to update; the rest
 * of the package consumes only the symbols re-exported here.
 */

// ---------- primitive aliases ----------

export type Point = [number, number];
export type Extent = [[number, number], [number, number]];
export type Color = [number, number, number];

// ---------- Expression sub-tree (subset used by Text.textString) ----------
//
// The full Expression union upstream is permissive (see
// `_shared/modelInstance.ts`). We mirror only what `expressionToString`
// needs to recognise; everything else is accepted as `unknown` and
// gracefully degraded to "" by the resolver.

export interface ComponentRefPart {
  name: string;
  subscripts?: Expression[] | undefined;
  [key: string]: unknown;
}

export interface ComponentRef {
  $kind: "cref";
  parts: ComponentRefPart[];
  [key: string]: unknown;
}

export interface CallExpr {
  $kind: "call";
  name: string;
  arguments: Expression[];
  [key: string]: unknown;
}

export type Expression =
  | string
  | number
  | boolean
  | null
  | ComponentRef
  | CallExpr
  | Expression[]
  | { [key: string]: Expression }
  | { $kind: string; [key: string]: unknown };

// ---------- coordinate system ----------
//
// Mirror of `CoordinateSystemSchema` upstream — `extent` is a loose
// `number[][]` because OMC sometimes emits ragged arrays. Renderers
// defensively normalise.

export interface CoordinateSystem {
  extent?: number[][] | undefined;
  preserveAspectRatio?: boolean | undefined;
  initialScale?: number | undefined;
  grid?: number[] | undefined;
  [key: string]: unknown;
}

// ---------- shapes ----------

export interface LineShape {
  kind: "line";
  points: Point[];
  color?: Color | undefined;
  thickness?: number | undefined;
  pattern?: string | undefined;
  arrow?: [string, string] | undefined;
  arrowSize?: number | undefined;
  smooth?: string | undefined;
}

export interface PolygonShape {
  kind: "polygon";
  points: Point[];
  lineColor?: Color | undefined;
  fillColor?: Color | undefined;
  pattern?: string | undefined;
  fillPattern?: string | undefined;
  lineThickness?: number | undefined;
  smooth?: string | undefined;
}

export interface RectangleShape {
  kind: "rectangle";
  extent: Extent;
  lineColor?: Color | undefined;
  fillColor?: Color | undefined;
  pattern?: string | undefined;
  fillPattern?: string | undefined;
  lineThickness?: number | undefined;
  borderPattern?: string | undefined;
  radius?: number | undefined;
}

export interface EllipseShape {
  kind: "ellipse";
  extent: Extent;
  lineColor?: Color | undefined;
  fillColor?: Color | undefined;
  pattern?: string | undefined;
  fillPattern?: string | undefined;
  lineThickness?: number | undefined;
  startAngle?: number | undefined;
  endAngle?: number | undefined;
  closure?: string | undefined;
}

export interface TextShape {
  kind: "text";
  extent: Extent;
  /** Stays as `Expression` (DynamicSelect round-trips, cref placeholder, etc.). */
  textString: Expression;
  fontName?: string | undefined;
  fontSize?: number | undefined;
  textColor?: Color | undefined;
  horizontalAlignment?: string | undefined;
  textStyle?: string[] | undefined;
}

export interface BitmapShape {
  kind: "bitmap";
  extent: Extent;
  fileName?: string | undefined;
  imageSource?: string | undefined;
}

export type Shape =
  | LineShape
  | PolygonShape
  | RectangleShape
  | EllipseShape
  | TextShape
  | BitmapShape;

// ---------- icon layers + class def ----------

export interface IconLayer {
  /** Qualified class name that contributed these shapes. */
  from: string;
  shapes: Shape[];
  coordinateSystem?: CoordinateSystem | undefined;
}

/**
 * Subset of the producer's `ClassDef` used by `renderClassIconToSvg`.
 * Other fields (`restriction`, `connectors`, etc.) exist upstream but we
 * don't read them here, so the consumer's full `ClassDef` is structurally
 * assignable to this.
 */
export interface ClassDef {
  name: string;
  iconLayers: IconLayer[];
  coordinateSystem?: CoordinateSystem | undefined;
  [key: string]: unknown;
}
