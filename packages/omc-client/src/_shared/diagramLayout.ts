/**
 * Renderer-agnostic diagram-layout shape produced from an OMC `ModelInstance`
 * tree. This is OUR shape, not OMC's — every field has a fixed meaning, every
 * recursion seam is hand-rolled, and we use `.strict()` everywhere because
 * forward-compatibility against OMC schema drift is the producer's job (it
 * decodes from the upstream `ModelInstance` schema in
 * `_shared/modelInstance.ts`), not the consumer's.
 *
 * Conventions mirror `modelInstance.ts`:
 *  - Recursive seams expose hand-written interfaces; the Zod schema is cast
 *    via `as unknown as z.ZodType<X>` so `z.infer` gives the interface back.
 *  - Optional fields are typed `T | undefined` to interoperate with both
 *    `exactOptionalPropertyTypes: true` and Zod's `.optional()` inference.
 *  - Unknown shape kinds, unknown fields, malformed positional records: the
 *    Zod schema rejects them. The producer is expected to filter / decode
 *    upstream and only ever hand the schema a typed object.
 *
 * Cross-references back to upstream types (`SourceLocation`, `Expression`,
 * `Modifier`, `CoordinateSystem`) are re-exported from `modelInstance.ts`
 * — duplicating them here would mean drift, not isolation.
 */

import { z } from "zod";

import {
  CoordinateSystemSchema,
  ExpressionSchema,
  ModifierSchema,
  SourceLocationSchema,
} from "./modelInstance.js";
import type {
  CoordinateSystem,
  Expression,
  Modifier,
  SourceLocation,
} from "./modelInstance.js";

export type {
  CoordinateSystem,
  Expression,
  Modifier,
  SourceLocation,
} from "./modelInstance.js";

// ---------- primitive value-shape helpers ----------
//
// These are not exported as types — they're internal building blocks for
// the schemas below. The hand-written interfaces use plain tuple types so
// downstream consumers don't have to know `z.infer`.

const PointSchema = z.tuple([z.number(), z.number()]);
const ExtentSchema = z.tuple([
  z.tuple([z.number(), z.number()]),
  z.tuple([z.number(), z.number()]),
]);
const ColorSchema = z.tuple([z.number(), z.number(), z.number()]);
const ArrowSchema = z.tuple([z.string(), z.string()]);

// ---------- public types ----------

export type Point = [number, number];
export type Extent = [[number, number], [number, number]];
export type Color = [number, number, number];

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
  /**
   * Stays as `Expression` (not flattened to a string) so DynamicSelect calls
   * round-trip and can be re-evaluated per-instance at render time.
   */
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

export interface IconLayer {
  /** Qualified class name that contributed these shapes (host class or any ancestor in its extends chain). */
  from: string;
  shapes: Shape[];
  coordinateSystem?: CoordinateSystem | undefined;
}

export interface Placement {
  extent: Extent;
  origin?: Point | undefined;
  /** Rotation in degrees, Modelica convention (counter-clockwise positive). */
  rotation?: number | undefined;
}

export interface PortDef {
  name: string;
  /** Qualified class name of the connector type (e.g. `Modelica.Blocks.Interfaces.RealInput`). */
  typeName: string;
  /** Placement of the port on the host class's coordinate system. */
  placement: Placement;
  /** Walked icon for the connector class itself. */
  iconLayers: IconLayer[];
  /** Class that DECLARED this port — host class name, or an ancestor in its extends chain. */
  from: string;
  /**
   * Causality + flow prefixes lifted from `ComponentElement.prefixes`.
   * Carried on the port so client-side compatibility checks (input ↔
   * output, flow ↔ flow) can run without an extra OMC round-trip per
   * connector.
   *
   *   - `direction`  — `"input"`, `"output"`, or `""` for acausal.
   *                    For directional connector types like
   *                    `RealInput`/`RealOutput` the direction is baked
   *                    into the type and the per-component prefix may
   *                    be empty — consumers should check both.
   *   - `flow`       — flow variable connector (Modelica §9.1).
   *   - `stream`     — stream variable connector (Modelica §15).
   */
  direction?: "input" | "output" | "" | undefined;
  flow?: boolean | undefined;
  stream?: boolean | undefined;
  source?: SourceLocation | undefined;
}

export interface ClassDef {
  name: string;
  restriction: string;
  iconLayers: IconLayer[];
  coordinateSystem?: CoordinateSystem | undefined;
  /** Ports declared on this class or any of its ancestors. */
  connectors: Record<string, PortDef>;
}

export interface ComponentInstance {
  name: string;
  /** Key into `DiagramLayout.classes` — the resolved type's qualified name. */
  classRef: string;
  placement: Placement;
  /** Per-instance modifier overrides (param values, redeclares). */
  modifiers?: Modifier | undefined;
  comment?: string | undefined;
  source?: SourceLocation | undefined;
}

export interface ConnectorInstance {
  name: string;
  classRef: string;
  placement: Placement;
  comment?: string | undefined;
  source?: SourceLocation | undefined;
}

export interface ConnectionEndpoint {
  /** First cref part if the port is on a sub-component; `undefined` for ports on the host class. */
  component: string | undefined;
  /** The port name (last cref part). */
  port: string;
}

export interface ConnectionLayout {
  lhs: ConnectionEndpoint;
  rhs: ConnectionEndpoint;
  /**
   * Routing waypoints from the connection's `annotation.Line.points`.
   * `[]` means the source had no waypoints — auto-route the connection.
   * The list is never `null`/`undefined`; missing waypoints normalize to `[]`.
   */
  waypoints: Point[];
  source?: SourceLocation | undefined;
}

export interface LabelLayout {
  text: Expression;
  extent: Extent;
  rotation: number;
  fontSize?: number | undefined;
  textColor?: Color | undefined;
}

export interface DiagramLayout {
  kind: "icon" | "diagram";
  /** Qualified host class name. */
  className: string;
  source: SourceLocation;
  coordinateSystem?: CoordinateSystem | undefined;

  /**
   * The host class's OWN icon visuals, layered by ancestor in post-order
   * (ancestors first, host last). Renderers stack later layers on top.
   */
  iconLayers: IconLayer[];
  /** Same arrangement, but for diagram-mode visuals. */
  diagramLayers: IconLayer[];
  /** Top-level Text shapes from the host's diagram annotation. */
  labels: LabelLayout[];

  /** Per-type catalog. One entry per unique `type.name` encountered. */
  classes: Record<string, ClassDef>;

  /** Sub-components keyed by instance name. */
  components: Record<string, ComponentInstance>;
  /** Standalone connectors on the host class, keyed by instance name. */
  connectors: Record<string, ConnectorInstance>;
  /** Only connections with `annotation.Line` are emitted here (see producer). */
  connections: ConnectionLayout[];
}

// ---------- Zod schemas ----------
//
// Strict (`.strict()`) — this is our shape, no forward-compat concern. The
// producer is the only thing constructing these objects, so any unrecognized
// field in here is a bug, not OMC schema drift.

export const LineShapeSchema = z
  .object({
    kind: z.literal("line"),
    points: z.array(PointSchema),
    color: ColorSchema.optional(),
    thickness: z.number().optional(),
    pattern: z.string().optional(),
    arrow: ArrowSchema.optional(),
    arrowSize: z.number().optional(),
    smooth: z.string().optional(),
  })
  .strict();

export const PolygonShapeSchema = z
  .object({
    kind: z.literal("polygon"),
    points: z.array(PointSchema),
    lineColor: ColorSchema.optional(),
    fillColor: ColorSchema.optional(),
    pattern: z.string().optional(),
    fillPattern: z.string().optional(),
    lineThickness: z.number().optional(),
    smooth: z.string().optional(),
  })
  .strict();

export const RectangleShapeSchema = z
  .object({
    kind: z.literal("rectangle"),
    extent: ExtentSchema,
    lineColor: ColorSchema.optional(),
    fillColor: ColorSchema.optional(),
    pattern: z.string().optional(),
    fillPattern: z.string().optional(),
    lineThickness: z.number().optional(),
    borderPattern: z.string().optional(),
    radius: z.number().optional(),
  })
  .strict();

export const EllipseShapeSchema = z
  .object({
    kind: z.literal("ellipse"),
    extent: ExtentSchema,
    lineColor: ColorSchema.optional(),
    fillColor: ColorSchema.optional(),
    pattern: z.string().optional(),
    fillPattern: z.string().optional(),
    lineThickness: z.number().optional(),
    startAngle: z.number().optional(),
    endAngle: z.number().optional(),
    closure: z.string().optional(),
  })
  .strict();

export const TextShapeSchema = z
  .object({
    kind: z.literal("text"),
    extent: ExtentSchema,
    textString: ExpressionSchema,
    fontName: z.string().optional(),
    fontSize: z.number().optional(),
    textColor: ColorSchema.optional(),
    horizontalAlignment: z.string().optional(),
    textStyle: z.array(z.string()).optional(),
  })
  .strict();

export const BitmapShapeSchema = z
  .object({
    kind: z.literal("bitmap"),
    extent: ExtentSchema,
    fileName: z.string().optional(),
    imageSource: z.string().optional(),
  })
  .strict();

/**
 * Discriminated on `kind` so a bogus shape kind fails fast with a clear
 * error rather than falling through to a permissive branch.
 */
export const ShapeSchema = z.discriminatedUnion("kind", [
  LineShapeSchema,
  PolygonShapeSchema,
  RectangleShapeSchema,
  EllipseShapeSchema,
  TextShapeSchema,
  BitmapShapeSchema,
]);

export const IconLayerSchema = z
  .object({
    from: z.string(),
    shapes: z.array(ShapeSchema),
    coordinateSystem: CoordinateSystemSchema.optional(),
  })
  .strict();

export const PlacementSchema = z
  .object({
    extent: ExtentSchema,
    origin: PointSchema.optional(),
    rotation: z.number().optional(),
  })
  .strict();

export const PortDefSchema = z
  .object({
    name: z.string(),
    typeName: z.string(),
    placement: PlacementSchema,
    iconLayers: z.array(IconLayerSchema),
    from: z.string(),
    source: SourceLocationSchema.optional(),
  })
  .strict();

export const ClassDefSchema = z
  .object({
    name: z.string(),
    restriction: z.string(),
    iconLayers: z.array(IconLayerSchema),
    coordinateSystem: CoordinateSystemSchema.optional(),
    connectors: z.record(z.string(), PortDefSchema),
  })
  .strict();

export const ComponentInstanceSchema = z
  .object({
    name: z.string(),
    classRef: z.string(),
    placement: PlacementSchema,
    modifiers: ModifierSchema.optional(),
    comment: z.string().optional(),
    source: SourceLocationSchema.optional(),
  })
  .strict();

export const ConnectorInstanceSchema = z
  .object({
    name: z.string(),
    classRef: z.string(),
    placement: PlacementSchema,
    comment: z.string().optional(),
    source: SourceLocationSchema.optional(),
  })
  .strict();

export const ConnectionEndpointSchema = z
  .object({
    component: z.string().optional(),
    port: z.string(),
  })
  .strict();

export const ConnectionLayoutSchema = z
  .object({
    lhs: ConnectionEndpointSchema,
    rhs: ConnectionEndpointSchema,
    waypoints: z.array(PointSchema),
    source: SourceLocationSchema.optional(),
  })
  .strict();

export const LabelLayoutSchema = z
  .object({
    text: ExpressionSchema,
    extent: ExtentSchema,
    rotation: z.number(),
    fontSize: z.number().optional(),
    textColor: ColorSchema.optional(),
  })
  .strict();

const DiagramLayoutObject = z
  .object({
    kind: z.union([z.literal("icon"), z.literal("diagram")]),
    className: z.string(),
    source: SourceLocationSchema,
    coordinateSystem: CoordinateSystemSchema.optional(),
    iconLayers: z.array(IconLayerSchema),
    diagramLayers: z.array(IconLayerSchema),
    labels: z.array(LabelLayoutSchema),
    classes: z.record(z.string(), ClassDefSchema),
    components: z.record(z.string(), ComponentInstanceSchema),
    connectors: z.record(z.string(), ConnectorInstanceSchema),
    connections: z.array(ConnectionLayoutSchema),
  })
  .strict();
export const DiagramLayoutSchema =
  DiagramLayoutObject as unknown as z.ZodType<DiagramLayout>;
