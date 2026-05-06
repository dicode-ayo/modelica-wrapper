/**
 * Recursive Zod schemas for OMC's `getModelInstance` JSON tree.
 *
 * Drives both `getModelInstance` and `getModelInstanceAnnotation` (the
 * annotation-only variant is a strict subset — same root shape, fewer
 * populated fields). The schema design is fixture-driven against OMC 1.26.7
 * captures of `Modelica.Blocks.Math.Sin` (leaf block) and
 * `Modelica.Blocks.Examples.PID_Controller` (full diagram with inheritance,
 * sub-component types, connections, and Dialog-enable expressions).
 *
 * Every object that can carry OMC-version-specific extras uses
 * `.passthrough()`: we'd rather forward unknown fields verbatim than throw on
 * a future OMC release. Recursion goes through `z.lazy(() => ...)` so the
 * tree depth (extends-of-extends, type-of-component) doesn't trip Zod's
 * eager-evaluation. Schemas are typed as `z.ZodType<unknown>` at the
 * recursive seams to sidestep TS's `exactOptionalPropertyTypes` divergence
 * between explicit interfaces and Zod's inferred outputs; consumers get
 * fully-typed values via `z.infer`.
 */

import { z } from "zod";

export const SourceLocationSchema = z
  .object({
    filename: z.string(),
    lineStart: z.number().int(),
    columnStart: z.number().int(),
    lineEnd: z.number().int(),
    columnEnd: z.number().int(),
  })
  .passthrough();
export type SourceLocation = z.infer<typeof SourceLocationSchema>;

export const ComponentRefSchema = z
  .object({
    $kind: z.literal("cref"),
    parts: z.array(
      z
        .object({
          name: z.string(),
          subscripts: z.array(z.unknown()).optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type ComponentRef = z.infer<typeof ComponentRefSchema>;

export const EnumLiteralSchema = z
  .object({
    $kind: z.literal("enum"),
    name: z.string(),
    index: z.number().int(),
  })
  .passthrough();
export type EnumLiteral = z.infer<typeof EnumLiteralSchema>;

/**
 * Generic expression node. OMC emits these inside Dialog-enable, modifier
 * bindings, DynamicSelect calls, etc. We recognise the known $kind variants
 * (`binary_op`, `unary_op`, `if`, `call`, `cref`, `enum`, `record`) and let
 * primitives, arrays, and plain key/value objects through verbatim. Tagged
 * recursively so Dialog conditions like `if PI.use_reset then [...] else
 * [...]` round-trip cleanly.
 */
export const ExpressionSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z
      .object({
        $kind: z.literal("binary_op"),
        op: z.string(),
        lhs: ExpressionSchema,
        rhs: ExpressionSchema,
      })
      .passthrough(),
    z
      .object({
        $kind: z.literal("unary_op"),
        op: z.string(),
        exp: ExpressionSchema,
      })
      .passthrough(),
    z
      .object({
        $kind: z.literal("if"),
        condition: ExpressionSchema,
        true: ExpressionSchema,
        false: ExpressionSchema,
      })
      .passthrough(),
    z
      .object({
        $kind: z.literal("call"),
        name: z.string(),
        arguments: z.array(ExpressionSchema),
      })
      .passthrough(),
    ComponentRefSchema,
    EnumLiteralSchema,
    RecordValueSchema,
    z.array(ExpressionSchema),
    z.record(z.string(), ExpressionSchema),
  ]),
);

/**
 * Tagged record for §18.6 graphic primitives (Polygon, Line, Rectangle,
 * Ellipse, Text, Bitmap) and any other Modelica record literal OMC needs to
 * preserve. `elements` is the positional argument list; producers narrow
 * per `name` to extract typed fields.
 */
export const RecordValueSchema: z.ZodType<{
  $kind: "record";
  name: string;
  elements: unknown[];
}> = z.lazy(() =>
  z
    .object({
      $kind: z.literal("record"),
      name: z.string(),
      elements: z.array(ExpressionSchema),
    })
    .passthrough(),
);
export type RecordValue = z.infer<typeof RecordValueSchema>;

export const CoordinateSystemSchema = z
  .object({
    extent: z.array(z.array(z.number())).optional(),
    preserveAspectRatio: z.boolean().optional(),
    initialScale: z.number().optional(),
    grid: z.array(z.number()).optional(),
  })
  .passthrough();
export type CoordinateSystem = z.infer<typeof CoordinateSystemSchema>;

export const GraphicAnnotationSchema = z
  .object({
    coordinateSystem: CoordinateSystemSchema.optional(),
    graphics: z.array(RecordValueSchema).optional(),
  })
  .passthrough();
export type GraphicAnnotation = z.infer<typeof GraphicAnnotationSchema>;

const TransformationSchema = z
  .object({
    origin: z.array(z.number()).optional(),
    extent: z.array(z.array(z.number())).optional(),
    rotation: z.number().optional(),
  })
  .passthrough();

/**
 * A `Placement` annotation. OMC routes all of `transformation`,
 * `iconTransformation`, and `visible` through here. The transformation
 * carries `extent`, optional `origin`, optional `rotation`.
 */
export const PlacementAnnotationSchema = z
  .object({
    visible: z.boolean().optional(),
    transformation: TransformationSchema.optional(),
    iconTransformation: TransformationSchema.optional(),
  })
  .passthrough();
export type PlacementAnnotation = z.infer<typeof PlacementAnnotationSchema>;

/**
 * Top-level annotation block. Well-known keys
 * (`Icon`/`Diagram`/`Documentation`/`Placement`) are typed; arbitrary
 * additional ones (vendor-specific, Dialog metadata, `defaultComponentName`,
 * `Line` on connections, etc.) pass through as `unknown`.
 */
export const AnnotationSchema = z
  .object({
    Icon: GraphicAnnotationSchema.optional(),
    Diagram: GraphicAnnotationSchema.optional(),
    Placement: PlacementAnnotationSchema.optional(),
    Documentation: z
      .object({
        info: z.string().optional(),
        revisions: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type Annotation = z.infer<typeof AnnotationSchema>;

/**
 * Modifier values can be a flat string (e.g. `"100"`, `"true"`,
 * `"Modelica.Blocks.Types.Init.SteadyState"`) or a nested record of further
 * modifiers. When OMC needs both — a value AND nested modifiers on the same
 * node — it keys the value as `$value` and the rest as siblings. Booleans
 * `final`/`each` may also appear at the modifier level.
 */
export const ModifierSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.record(z.string(), ModifierSchema),
  ]),
);

export const PrefixesSchema = z
  .object({
    partial: z.boolean().optional(),
    public: z.boolean().optional(),
    connector: z.string().optional(),
    variability: z.string().optional(),
    direction: z.string().optional(),
    final: z.boolean().optional(),
    flow: z.boolean().optional(),
    stream: z.boolean().optional(),
    inner: z.boolean().optional(),
    outer: z.boolean().optional(),
    replaceable: z.boolean().optional(),
    redeclare: z.boolean().optional(),
  })
  .passthrough();
export type Prefixes = z.infer<typeof PrefixesSchema>;

export const ImportSchema = z
  .object({
    path: z.string(),
  })
  .passthrough();
export type Import = z.infer<typeof ImportSchema>;

export const ModelInstanceSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      name: z.string(),
      restriction: z.string(),
      comment: z.string().optional(),
      prefixes: PrefixesSchema.optional(),
      annotation: AnnotationSchema.optional(),
      elements: z.array(ElementSchema).optional(),
      imports: z.array(ImportSchema).optional(),
      connections: z.array(ConnectionSchema).optional(),
      source: SourceLocationSchema.optional(),
    })
    .passthrough(),
);

/**
 * Component element. `type: {}` (empty object) appears when the component's
 * type couldn't be resolved (degraded mode); we accept it as a permissive
 * passthrough rather than failing the parse.
 */
export const ComponentElementSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      $kind: z.literal("component"),
      name: z.string(),
      type: z.union([ModelInstanceSchema, z.object({}).passthrough()]),
      comment: z.string().optional(),
      prefixes: PrefixesSchema.optional(),
      modifiers: ModifierSchema.optional(),
      value: z.unknown().optional(),
      condition: z.unknown().optional(),
      dims: z.unknown().optional(),
      annotation: AnnotationSchema.optional(),
    })
    .passthrough(),
);

export const ExtendsElementSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      $kind: z.literal("extends"),
      baseClass: z.union([ModelInstanceSchema, z.string()]),
      modifiers: ModifierSchema.optional(),
      annotation: AnnotationSchema.optional(),
    })
    .passthrough(),
);

export const ElementSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([ComponentElementSchema, ExtendsElementSchema]),
);

export const ConnectionSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      lhs: ComponentRefSchema,
      rhs: ComponentRefSchema,
      annotation: AnnotationSchema.optional(),
    })
    .passthrough(),
);

/**
 * Loose top-level shape consumers can rely on without descending into the
 * recursive tree. The deeper structure is validated by the recursive
 * `*Schema` types above and exposed verbatim under each key.
 */
export interface ModelInstance {
  name: string;
  restriction: string;
  comment?: string;
  prefixes?: Prefixes;
  annotation?: Annotation;
  elements?: unknown[];
  imports?: Import[];
  connections?: unknown[];
  source?: SourceLocation;
  [key: string]: unknown;
}

export interface ComponentElement {
  $kind: "component";
  name: string;
  type: ModelInstance | Record<string, unknown>;
  comment?: string;
  prefixes?: Prefixes;
  modifiers?: unknown;
  value?: unknown;
  condition?: unknown;
  dims?: unknown;
  annotation?: Annotation;
  [key: string]: unknown;
}

export interface ExtendsElement {
  $kind: "extends";
  baseClass: ModelInstance | string;
  modifiers?: unknown;
  annotation?: Annotation;
  [key: string]: unknown;
}

export type ElementNode = ComponentElement | ExtendsElement;

export interface ConnectionNode {
  lhs: ComponentRef;
  rhs: ComponentRef;
  annotation?: Annotation;
  [key: string]: unknown;
}

/**
 * `getModelInstanceAnnotation` returns the same root shape as
 * `getModelInstance`, just with subcomponent types / inner elements pruned
 * to annotation-only data. Today they share the same schema. Diverge here
 * if a future OMC release thins the shape further.
 */
export const ModelInstanceAnnotationSchema = ModelInstanceSchema;
export type ModelInstanceAnnotation = ModelInstance;
