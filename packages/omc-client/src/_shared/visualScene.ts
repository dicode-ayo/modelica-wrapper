/**
 * Renderer-agnostic MultiBody scene shapes produced from OMC's
 * `<Model>_visual.xml` backend artifact (the `-d=visxml` translateModel side
 * effect). Two stages:
 *
 *   1. `VisualXmlDocument` — record-faithful parse of the XML; each shape
 *      slot is still an `XmlExpr` AST so the resolver can substitute crefs
 *      against a runtime `env: Map<string, number>` (init-solve row 0 values
 *      from `_res.mat`) WITHOUT re-parsing.
 *   2. `VisualScene` — resolved snapshot. Every literal-valued slot is a
 *      `number`. Shapes whose expression tree still references an unknown
 *      cref carry `unresolved: true` so the renderer can show a placeholder
 *      rather than silently positioning at the origin.
 *
 * Conventions mirror `diagramLayout.ts` and `modelInstance.ts`:
 *  - `.strict()` on every Zod object (this is OUR shape, drift = bug)
 *  - Recursive seams use hand-written interfaces + the
 *    `as unknown as z.ZodType<X>` cast so `z.infer` gives the interface back
 *  - Optional fields are typed `T | undefined` to interoperate with
 *    `exactOptionalPropertyTypes: true` and Zod's `.optional()` inference
 *
 * The vector and surface schemas are defined so PR 7 can land without a
 * schema migration; PR 1's resolver and tests only exercise shapes.
 */

import { z } from "zod";

import { ComponentRefSchema } from "./modelInstance.js";
import type { ComponentRef } from "./modelInstance.js";

// ---------- primitive value helpers ----------

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
const Mat3Schema = z.tuple([Vec3Schema, Vec3Schema, Vec3Schema]);
const RgbSchema = z.tuple([z.number(), z.number(), z.number()]);

export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];
export type Rgb = [number, number, number];

// =====================================================================
// Stage 1: XML expression AST + record-faithful document
// =====================================================================

/**
 * Expression AST for an `<exp>` slot in `_visual.xml`. OMC emits one of:
 *  - a literal number (`<exp>0.5</exp>`)
 *  - a cref reference (`<cref>body.r[1]</cref>`)
 *  - a binary op (`<binary><op>+</op><lhs>…</lhs><rhs>…</rhs></binary>`)
 *  - a unary op (`<unary><op>-</op><exp>…</exp></unary>`)
 *  - a call (`<call><fn>cos</fn><arg>…</arg></call>`)
 *
 * The resolver walks this tree; the parser produces it verbatim from XML.
 */
export type XmlExpr =
  | { kind: "lit"; value: number }
  | { kind: "cref"; name: string }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; lhs: XmlExpr; rhs: XmlExpr }
  | { kind: "unary"; op: "-"; exp: XmlExpr }
  | { kind: "call"; fn: "cos" | "sin" | "sqrt"; args: XmlExpr[] };

const XmlExprLazy: z.ZodType<XmlExpr> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("lit"), value: z.number() }).strict(),
    z.object({ kind: z.literal("cref"), name: z.string() }).strict(),
    z
      .object({
        kind: z.literal("binary"),
        op: z.union([
          z.literal("+"),
          z.literal("-"),
          z.literal("*"),
          z.literal("/"),
        ]),
        lhs: XmlExprLazy,
        rhs: XmlExprLazy,
      })
      .strict(),
    z
      .object({
        kind: z.literal("unary"),
        op: z.literal("-"),
        exp: XmlExprLazy,
      })
      .strict(),
    z
      .object({
        kind: z.literal("call"),
        fn: z.union([z.literal("cos"), z.literal("sin"), z.literal("sqrt")]),
        args: z.array(XmlExprLazy),
      })
      .strict(),
  ]),
);
export const XmlExprSchema = XmlExprLazy;

/** A Vec3 in the XML form: three `<exp>` slots, not yet resolved. */
export type XmlVec3 = [XmlExpr, XmlExpr, XmlExpr];

/** A Mat3 in the XML form: nine `<exp>` slots, not yet resolved. */
export type XmlMat3 = [XmlVec3, XmlVec3, XmlVec3];

const XmlVec3Schema = z.tuple([XmlExprSchema, XmlExprSchema, XmlExprSchema]);
const XmlMat3Schema = z.tuple([XmlVec3Schema, XmlVec3Schema, XmlVec3Schema]);

/**
 * Unresolved shape — verbatim from the XML, every slot still an `XmlExpr`.
 * `ident` is the dotted instance path from `<ident>` (e.g.
 * `bodyShape1.shape_1`) used later by `joinWithModelInstance` to map back
 * to a `ComponentElement` in the `ModelInstance` tree.
 *
 * `shapeType` is the raw string from `<type>`: either a primitive name
 * (`"box"`, `"cylinder"`, …) or a Modelica resource URI for file meshes
 * (`"modelica://Pkg/Resources/foo.stl"`).
 */
export interface XmlShape {
  kind: "shape";
  ident: string;
  shapeType: string;
  r: XmlVec3;
  T: XmlMat3;
  rShape: XmlVec3;
  lengthDirection: XmlVec3;
  widthDirection: XmlVec3;
  length: XmlExpr;
  width: XmlExpr;
  height: XmlExpr;
  extra: XmlExpr;
  color: [XmlExpr, XmlExpr, XmlExpr];
  specularCoefficient: XmlExpr;
}

const XmlShapeObject = z
  .object({
    kind: z.literal("shape"),
    ident: z.string(),
    shapeType: z.string(),
    r: XmlVec3Schema,
    T: XmlMat3Schema,
    rShape: XmlVec3Schema,
    lengthDirection: XmlVec3Schema,
    widthDirection: XmlVec3Schema,
    length: XmlExprSchema,
    width: XmlExprSchema,
    height: XmlExprSchema,
    extra: XmlExprSchema,
    color: z.tuple([XmlExprSchema, XmlExprSchema, XmlExprSchema]),
    specularCoefficient: XmlExprSchema,
  })
  .strict();
export const XmlShapeSchema = XmlShapeObject as unknown as z.ZodType<XmlShape>;

/**
 * Force / torque / gravity arrow. Schema reserved so PR 7 can land
 * without a migration; PR 1 leaves the resolver / tests focused on shapes.
 */
export interface XmlVector {
  kind: "vector";
  ident: string;
  r: XmlVec3;
  T: XmlMat3;
  coordinates: XmlVec3;
  color: [XmlExpr, XmlExpr, XmlExpr];
  specularCoefficient: XmlExpr;
  quantity: string;
  headAtOrigin: XmlExpr;
  twoHeadedArrow: XmlExpr;
}

const XmlVectorObject = z
  .object({
    kind: z.literal("vector"),
    ident: z.string(),
    r: XmlVec3Schema,
    T: XmlMat3Schema,
    coordinates: XmlVec3Schema,
    color: z.tuple([XmlExprSchema, XmlExprSchema, XmlExprSchema]),
    specularCoefficient: XmlExprSchema,
    quantity: z.string(),
    headAtOrigin: XmlExprSchema,
    twoHeadedArrow: XmlExprSchema,
  })
  .strict();
export const XmlVectorSchema =
  XmlVectorObject as unknown as z.ZodType<XmlVector>;

/**
 * Parametric surface (`Visualizers.Advanced.Surface`). Schema reserved;
 * PR 1 ships the type but doesn't resolve the function-valued u,v grid.
 */
export interface XmlSurface {
  kind: "surface";
  ident: string;
  r: XmlVec3;
  T: XmlMat3;
  nu: XmlExpr;
  nv: XmlExpr;
  color: [XmlExpr, XmlExpr, XmlExpr];
  specularCoefficient: XmlExpr;
  transparency: XmlExpr;
  wireframe: XmlExpr;
  multiColored: XmlExpr;
}

const XmlSurfaceObject = z
  .object({
    kind: z.literal("surface"),
    ident: z.string(),
    r: XmlVec3Schema,
    T: XmlMat3Schema,
    nu: XmlExprSchema,
    nv: XmlExprSchema,
    color: z.tuple([XmlExprSchema, XmlExprSchema, XmlExprSchema]),
    specularCoefficient: XmlExprSchema,
    transparency: XmlExprSchema,
    wireframe: XmlExprSchema,
    multiColored: XmlExprSchema,
  })
  .strict();
export const XmlSurfaceSchema =
  XmlSurfaceObject as unknown as z.ZodType<XmlSurface>;

export type XmlVisualizer = XmlShape | XmlVector | XmlSurface;

export const XmlVisualizerSchema = z.discriminatedUnion("kind", [
  XmlShapeObject,
  XmlVectorObject,
  XmlSurfaceObject,
]) as unknown as z.ZodType<XmlVisualizer>;

export interface VisualXmlDocument {
  shapes: XmlShape[];
  vectors: XmlVector[];
  surfaces: XmlSurface[];
}

export const VisualXmlDocumentSchema = z
  .object({
    shapes: z.array(XmlShapeSchema),
    vectors: z.array(XmlVectorSchema),
    surfaces: z.array(XmlSurfaceSchema),
  })
  .strict() as unknown as z.ZodType<VisualXmlDocument>;

// =====================================================================
// Stage 2: resolved scene
// =====================================================================

/**
 * Forward-looking roundtrip seam (populated in a later authoring PR).
 * Pairs a Modelica `ComponentRef` with the modifier path whose value
 * drives a given pose slot — e.g. for `FixedTranslation`, `r` is bound
 * directly to `bodyShape1.r`. PR 1 reserves the field; the resolver leaves
 * it `undefined`.
 *
 * TODO(roundtrip): populate from `<cref>` paths whose entire expression
 * tree is a single direct binding (no arithmetic / call wrapping).
 */
export interface ParameterSource {
  component: ComponentRef;
  modifierPath: string[];
}

const ParameterSourceObject = z
  .object({
    component: ComponentRefSchema,
    modifierPath: z.array(z.string()),
  })
  .strict();
export const ParameterSourceSchema =
  ParameterSourceObject as unknown as z.ZodType<ParameterSource>;

/**
 * Resolved shape. Every numeric slot is a `number`; the world-frame and
 * shape-local orientation are pinned to `r`, `T`, `rShape`,
 * `lengthDirection`, `widthDirection`.
 *
 * `unresolved` is `true` IFF any slot in the original expression tree
 * still referenced an unknown cref after substitution. Renderer-side
 * contract: shapes with `unresolved: true` get a placeholder (dashed
 * bounding box + "?" label) rather than dropping to the origin.
 *
 * `componentRef` is `null` for synthetic shapes (gravity arrow, world
 * frame triad) that don't correspond to a user-authored component.
 * `undefined` means "not yet joined" (i.e. produced before
 * `joinWithModelInstance` ran).
 */
export interface VisualShape {
  kind: "shape";
  ident: string;
  shapeType: string;
  r: Vec3;
  T: Mat3;
  rShape: Vec3;
  lengthDirection: Vec3;
  widthDirection: Vec3;
  length: number;
  width: number;
  height: number;
  extra: number;
  color: Rgb;
  specularCoefficient: number;
  unresolved?: boolean | undefined;
  componentRef?: ComponentRef | null | undefined;
  parameterSource?: ParameterSource | undefined;
}

const VisualShapeObject = z
  .object({
    kind: z.literal("shape"),
    ident: z.string(),
    shapeType: z.string(),
    r: Vec3Schema,
    T: Mat3Schema,
    rShape: Vec3Schema,
    lengthDirection: Vec3Schema,
    widthDirection: Vec3Schema,
    length: z.number(),
    width: z.number(),
    height: z.number(),
    extra: z.number(),
    color: RgbSchema,
    specularCoefficient: z.number(),
    unresolved: z.boolean().optional(),
    componentRef: z.union([ComponentRefSchema, z.null()]).optional(),
    parameterSource: ParameterSourceSchema.optional(),
  })
  .strict();
export const VisualShapeSchema =
  VisualShapeObject as unknown as z.ZodType<VisualShape>;

/** Resolved vector. PR 1 reserves it; PR 7 ships the renderer. */
export interface VisualVector {
  kind: "vector";
  ident: string;
  r: Vec3;
  T: Mat3;
  coordinates: Vec3;
  color: Rgb;
  specularCoefficient: number;
  quantity: string;
  headAtOrigin: boolean;
  twoHeadedArrow: boolean;
  unresolved?: boolean | undefined;
  componentRef?: ComponentRef | null | undefined;
  parameterSource?: ParameterSource | undefined;
}

const VisualVectorObject = z
  .object({
    kind: z.literal("vector"),
    ident: z.string(),
    r: Vec3Schema,
    T: Mat3Schema,
    coordinates: Vec3Schema,
    color: RgbSchema,
    specularCoefficient: z.number(),
    quantity: z.string(),
    headAtOrigin: z.boolean(),
    twoHeadedArrow: z.boolean(),
    unresolved: z.boolean().optional(),
    componentRef: z.union([ComponentRefSchema, z.null()]).optional(),
    parameterSource: ParameterSourceSchema.optional(),
  })
  .strict();
export const VisualVectorSchema =
  VisualVectorObject as unknown as z.ZodType<VisualVector>;

/** Resolved surface. PR 1 reserves it; the renderer follows later. */
export interface VisualSurface {
  kind: "surface";
  ident: string;
  r: Vec3;
  T: Mat3;
  nu: number;
  nv: number;
  color: Rgb;
  specularCoefficient: number;
  transparency: number;
  wireframe: boolean;
  multiColored: boolean;
  unresolved?: boolean | undefined;
  componentRef?: ComponentRef | null | undefined;
  parameterSource?: ParameterSource | undefined;
}

const VisualSurfaceObject = z
  .object({
    kind: z.literal("surface"),
    ident: z.string(),
    r: Vec3Schema,
    T: Mat3Schema,
    nu: z.number(),
    nv: z.number(),
    color: RgbSchema,
    specularCoefficient: z.number(),
    transparency: z.number(),
    wireframe: z.boolean(),
    multiColored: z.boolean(),
    unresolved: z.boolean().optional(),
    componentRef: z.union([ComponentRefSchema, z.null()]).optional(),
    parameterSource: ParameterSourceSchema.optional(),
  })
  .strict();
export const VisualSurfaceSchema =
  VisualSurfaceObject as unknown as z.ZodType<VisualSurface>;

export type Visualizer = VisualShape | VisualVector | VisualSurface;

export const VisualizerSchema = z.discriminatedUnion("kind", [
  VisualShapeObject,
  VisualVectorObject,
  VisualSurfaceObject,
]) as unknown as z.ZodType<Visualizer>;

/** Resolved scene: literal-valued, renderer-agnostic. */
export interface VisualScene {
  shapes: VisualShape[];
  vectors: VisualVector[];
  surfaces: VisualSurface[];
}

export const VisualSceneSchema = z
  .object({
    shapes: z.array(VisualShapeSchema),
    vectors: z.array(VisualVectorSchema),
    surfaces: z.array(VisualSurfaceSchema),
  })
  .strict() as unknown as z.ZodType<VisualScene>;

/**
 * Scene + per-shape `ComponentRef` join. Same field layout as
 * `VisualScene`; the join only ever sets `componentRef` (never mutates
 * geometry), so the two types are structurally identical and shareable.
 */
export type MultibodyScene = VisualScene;
export const MultibodySceneSchema = VisualSceneSchema;
