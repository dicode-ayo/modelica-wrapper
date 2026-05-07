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
 * eager-evaluation. Recursive seams expose hand-written interfaces
 * (`ModelInstance`, `ElementNode`, `Expression`, …) so consumers can walk
 * the tree without casts; the schemas themselves stay un-annotated where
 * possible so `z.discriminatedUnion` can detect the `$kind` discriminator.
 *
 * Tagged-shape unions use `z.discriminatedUnion("$kind", […])` rather than
 * `z.union(…)`: a typo'd `$kind` then fails fast with a clear message instead
 * of falling through to a permissive branch, and validation no longer
 * short-circuits on the first match. Permissive `z.object({}).passthrough()`
 * fallbacks are deliberately avoided — they make recursive validation a
 * no-op (the union short-circuits on the wildcard match).
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

// ===== Hand-written public types =====
//
// These mirror the schema shape and are the types external consumers see.
// Recursive seam schemas are cast to `z.ZodType<X>` so `z.infer` gives the
// hand-written interface; wrappers can return them without an `as` cast.
// `?: T | undefined` on optional fields keeps the interfaces compatible
// with both `exactOptionalPropertyTypes: true` consumers and Zod's
// `.optional()` inference (which is `T | undefined`).

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

export interface EnumLiteral {
  $kind: "enum";
  name: string;
  index: number;
  [key: string]: unknown;
}

export interface RecordValue {
  $kind: "record";
  name: string;
  elements: Expression[];
  [key: string]: unknown;
}

export interface BinaryOpExpr {
  $kind: "binary_op";
  op: string;
  lhs: Expression;
  rhs: Expression;
  [key: string]: unknown;
}

export interface UnaryOpExpr {
  $kind: "unary_op";
  op: string;
  exp: Expression;
  [key: string]: unknown;
}

export interface IfExpr {
  $kind: "if";
  condition: Expression;
  true: Expression;
  false: Expression;
  [key: string]: unknown;
}

export interface CallExpr {
  $kind: "call";
  name: string;
  arguments: Expression[];
  [key: string]: unknown;
}

/**
 * Generic expression node. OMC emits these inside Dialog-enable, modifier
 * bindings, DynamicSelect calls, etc. The known $kind variants
 * (`binary_op`, `unary_op`, `if`, `call`, `cref`, `enum`, `record`) are
 * tagged via `z.discriminatedUnion`; primitives, arrays, and plain
 * key/value objects are accepted verbatim. Tagged recursively so Dialog
 * conditions like `if PI.use_reset then [...] else [...]` round-trip.
 */
export type Expression =
  | string
  | number
  | boolean
  | null
  | BinaryOpExpr
  | UnaryOpExpr
  | IfExpr
  | CallExpr
  | ComponentRef
  | EnumLiteral
  | RecordValue
  | Expression[]
  | { [key: string]: Expression };

// Branch schemas left un-annotated so `z.discriminatedUnion` keeps the
// `$kind` discriminator visible at the type level.
const ComponentRefBranch = z.lazy(() =>
  z
    .object({
      $kind: z.literal("cref"),
      parts: z.array(
        z
          .object({
            name: z.string(),
            subscripts: z.array(ExpressionSchema).optional(),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
);
export const ComponentRefSchema = ComponentRefBranch as unknown as z.ZodType<ComponentRef>;

const EnumLiteralBranch = z
  .object({
    $kind: z.literal("enum"),
    name: z.string(),
    index: z.number().int(),
  })
  .passthrough();
export const EnumLiteralSchema = EnumLiteralBranch as unknown as z.ZodType<EnumLiteral>;

/**
 * Tagged record for §18.6 graphic primitives (Polygon, Line, Rectangle,
 * Ellipse, Text, Bitmap) and any other Modelica record literal OMC needs to
 * preserve. `elements` is the positional argument list; producers narrow
 * per `name` to extract typed fields.
 */
const RecordValueBranch = z.lazy(() =>
  z
    .object({
      $kind: z.literal("record"),
      name: z.string(),
      elements: z.array(ExpressionSchema),
    })
    .passthrough(),
);
export const RecordValueSchema = RecordValueBranch as unknown as z.ZodType<RecordValue>;

const BinaryOpExprBranch = z.lazy(() =>
  z
    .object({
      $kind: z.literal("binary_op"),
      op: z.string(),
      lhs: ExpressionSchema,
      rhs: ExpressionSchema,
    })
    .passthrough(),
);

const UnaryOpExprBranch = z.lazy(() =>
  z
    .object({
      $kind: z.literal("unary_op"),
      op: z.string(),
      exp: ExpressionSchema,
    })
    .passthrough(),
);

const IfExprBranch = z.lazy(() =>
  z
    .object({
      $kind: z.literal("if"),
      condition: ExpressionSchema,
      true: ExpressionSchema,
      false: ExpressionSchema,
    })
    .passthrough(),
);

const CallExprBranch = z.lazy(() =>
  z
    .object({
      $kind: z.literal("call"),
      name: z.string(),
      arguments: z.array(ExpressionSchema),
    })
    .passthrough(),
);

const TaggedExpressionSchema = z.lazy(() =>
  z.discriminatedUnion("$kind", [
    BinaryOpExprBranch,
    UnaryOpExprBranch,
    IfExprBranch,
    CallExprBranch,
    ComponentRefBranch,
    EnumLiteralBranch,
    RecordValueBranch,
  ]),
);

const ExpressionLazy = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    TaggedExpressionSchema,
    z.array(ExpressionSchema),
    z.record(z.string(), ExpressionSchema),
  ]),
);
export const ExpressionSchema = ExpressionLazy as unknown as z.ZodType<Expression>;

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
export type Modifier =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Modifier };

const ModifierLazy = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.record(z.string(), ModifierSchema),
  ]),
);
export const ModifierSchema = ModifierLazy as unknown as z.ZodType<Modifier>;

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

/**
 * Full structured shape consumers can walk without casts. Recursive types
 * (`ElementNode`, `ConnectionNode`, nested `ModelInstance`) are surfaced
 * verbatim — both schema inference and the wrapper return type point here.
 */
export interface ModelInstance {
  name: string;
  restriction: string;
  comment?: string | undefined;
  prefixes?: Prefixes | undefined;
  annotation?: Annotation | undefined;
  elements?: ElementNode[] | undefined;
  imports?: Import[] | undefined;
  connections?: ConnectionNode[] | undefined;
  source?: SourceLocation | undefined;
  [key: string]: unknown;
}

export interface ComponentElement {
  $kind: "component";
  name: string;
  /**
   * Resolved component type. Three shapes seen in OMC 1.26.7:
   *  - full nested `ModelInstance` (the common case)
   *  - primitive type name as a string (`"Real"`, `"Boolean"`, …) for
   *    leaf-typed components like `controlError`
   *  - missing entirely on bare components like enum literals
   *    (`{$kind:"component", name:"P", comment:"…"}`)
   */
  type?: ModelInstance | string | undefined;
  comment?: string | undefined;
  prefixes?: Prefixes | undefined;
  modifiers?: Modifier | undefined;
  value?: unknown;
  condition?: unknown;
  dims?: unknown;
  annotation?: Annotation | undefined;
  [key: string]: unknown;
}

export interface ExtendsElement {
  $kind: "extends";
  baseClass: ModelInstance | string;
  modifiers?: Modifier | undefined;
  annotation?: Annotation | undefined;
  [key: string]: unknown;
}

export type ElementNode = ComponentElement | ExtendsElement;

export interface ConnectionNode {
  lhs: ComponentRef;
  rhs: ComponentRef;
  annotation?: Annotation | undefined;
  [key: string]: unknown;
}

const ModelInstanceLazy = z.lazy(() =>
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
export const ModelInstanceSchema = ModelInstanceLazy as unknown as z.ZodType<ModelInstance>;

/**
 * Component element. `type` is a discriminated three-way shape (see
 * `ComponentElement` doc) — `optional` rather than a permissive
 * passthrough so a mistyped component (e.g. `type: 42`) fails fast.
 */
const ComponentElementBranch = z.lazy(() =>
  z
    .object({
      $kind: z.literal("component"),
      name: z.string(),
      type: z.union([ModelInstanceSchema, z.string()]).optional(),
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
export const ComponentElementSchema = ComponentElementBranch as unknown as z.ZodType<ComponentElement>;

const ExtendsElementBranch = z.lazy(() =>
  z
    .object({
      $kind: z.literal("extends"),
      baseClass: z.union([ModelInstanceSchema, z.string()]),
      modifiers: ModifierSchema.optional(),
      annotation: AnnotationSchema.optional(),
    })
    .passthrough(),
);
export const ExtendsElementSchema = ExtendsElementBranch as unknown as z.ZodType<ExtendsElement>;

const ElementLazy = z.lazy(() =>
  z.discriminatedUnion("$kind", [
    ComponentElementBranch,
    ExtendsElementBranch,
  ]),
);
export const ElementSchema = ElementLazy as unknown as z.ZodType<ElementNode>;

const ConnectionLazy = z.lazy(() =>
  z
    .object({
      lhs: ComponentRefSchema,
      rhs: ComponentRefSchema,
      annotation: AnnotationSchema.optional(),
    })
    .passthrough(),
);
export const ConnectionSchema = ConnectionLazy as unknown as z.ZodType<ConnectionNode>;

/**
 * `getModelInstanceAnnotation` returns the same root shape as
 * `getModelInstance`, just with subcomponent types / inner elements pruned
 * to annotation-only data. Today they share the same schema. Diverge here
 * if a future OMC release thins the shape further.
 */
export const ModelInstanceAnnotationSchema = ModelInstanceSchema;
export type ModelInstanceAnnotation = ModelInstance;
