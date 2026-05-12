/**
 * @modelica-wrapper/omc-client — public surface.
 *
 * Two consumption styles:
 *
 *   1. Class API (most callers):
 *
 *        import { OmcClient } from "@modelica-wrapper/omc-client";
 *        const client = await OmcClient.create();
 *        const { version } = await client.getVersion();
 *
 *   2. Functional API (tree-shakable; compose your own CallContext):
 *
 *        import { getVersion } from "@modelica-wrapper/omc-client/api/browsing";
 *        const result = await getVersion(myCtx, {});
 *
 * Each per-function module also exports `<Fn>InputSchema`, `<Fn>OutputSchema`,
 * and the inferred `<Fn>Input`/`<Fn>Output` types for callers that want to
 * pre-validate or generate UI from the schemas.
 */

// --- Class API ---
export { OmcClient, type OmcClientOptions } from "./client.js";

// --- Generic dispatcher with runtime input + output validation ---
export {
  REGISTRY,
  omcFunctionNames,
  functionsByCategory,
  type OmcFnName,
  type OmcInput,
  type OmcOutput,
} from "./registry.js";

// --- Supported OMC version pin (see docs/audit.md) ---
export {
  SUPPORTED_OMC,
  parseOmcVersion,
  compatibilityReport,
  type OmcVersion,
  type CompatibilityLevel,
  type CompatibilityReport,
} from "./version.js";

// --- Shared layer (CallContext, parseOutput, ValueSchema) ---
export {
  type CallContext,
  parseOutput,
  ValueSchema,
  TypeNameInput,
  OptionalTypeNameInput,
  ModelInstanceSchema,
  ModelInstanceAnnotationSchema,
  ComponentRefSchema,
  ComponentElementSchema,
  ExtendsElementSchema,
  ElementSchema,
  ConnectionSchema,
  AnnotationSchema,
  GraphicAnnotationSchema,
  PlacementAnnotationSchema,
  CoordinateSystemSchema,
  RecordValueSchema,
  EnumLiteralSchema,
  ExpressionSchema,
  PrefixesSchema,
  ImportSchema,
  SourceLocationSchema,
  type ModelInstance,
  type ModelInstanceAnnotation,
  type ComponentRef,
  type ComponentElement,
  type ExtendsElement,
  type ElementNode,
  type ConnectionNode,
  type Annotation,
  type GraphicAnnotation,
  type PlacementAnnotation,
  type CoordinateSystem,
  type RecordValue,
  type EnumLiteral,
  type Prefixes,
  type Import,
  type SourceLocation,
  type ComponentRefPart,
  type BinaryOpExpr,
  type UnaryOpExpr,
  type IfExpr,
  type CallExpr,
  type Expression,
  type Modifier,
  // DiagramLayout (producer output)
  LineShapeSchema,
  PolygonShapeSchema,
  RectangleShapeSchema,
  EllipseShapeSchema,
  TextShapeSchema,
  BitmapShapeSchema,
  ShapeSchema,
  IconLayerSchema,
  PlacementSchema,
  PortDefSchema,
  ClassDefSchema,
  ComponentInstanceSchema,
  ConnectorInstanceSchema,
  ConnectionEndpointSchema,
  ConnectionLayoutSchema,
  LabelLayoutSchema,
  DiagramLayoutSchema,
  type Point,
  type Extent,
  type Color,
  type LineShape,
  type PolygonShape,
  type RectangleShape,
  type EllipseShape,
  type TextShape,
  type BitmapShape,
  type Shape,
  type IconLayer,
  type Placement,
  type PortDef,
  type ClassDef,
  type ComponentInstance,
  type ConnectorInstance,
  type ConnectionEndpoint,
  type ConnectionLayout,
  type LabelLayout,
  type DiagramLayout,
  // MultiBody visual scene (producer output)
  XmlExprSchema,
  XmlShapeSchema,
  XmlVectorSchema,
  XmlSurfaceSchema,
  XmlVisualizerSchema,
  VisualXmlDocumentSchema,
  VisualShapeSchema,
  VisualVectorSchema,
  VisualSurfaceSchema,
  VisualizerSchema,
  VisualSceneSchema,
  MultibodySceneSchema,
  ParameterSourceSchema,
  parseVisualXml,
  resolveExpressions,
  produceVisualScene,
  joinWithModelInstance,
  type Vec3,
  type Mat3,
  type Rgb,
  type XmlExpr,
  type XmlVec3,
  type XmlMat3,
  type XmlShape,
  type XmlVector,
  type XmlSurface,
  type XmlVisualizer,
  type VisualXmlDocument,
  type VisualShape,
  type VisualVector,
  type VisualSurface,
  type Visualizer,
  type VisualScene,
  type MultibodyScene,
  type ParameterSource,
} from "./_shared/index.js";

// --- Lower-level transport / process / parser (advanced use) ---
export type { OmcCommand, OmcFunction } from "./commands.js";
export { OmcTransport } from "./transport.js";
export { spawnOmc, type OmcProcess } from "./process.js";
export {
  parse,
  toJson,
  isNull,
  asString,
  asBool,
  asInt,
  asFloat,
  asList,
  asStringList,
  expectString,
  expectBool,
  expectInt,
  expectFloat,
  expectList,
  expectStringList,
  type Value,
  type Json,
} from "./parse.js";

// --- Functional API (re-export by category) ---
export * as browsing from "./api/browsing/index.js";
export * as contents from "./api/contents/index.js";
export * as diagram from "./api/diagram/index.js";
export * as editing from "./api/editing/index.js";
export * as elements from "./api/elements/index.js";
export * as execution from "./api/execution/index.js";
export * as library from "./api/library/index.js";
export * as lifecycle from "./api/lifecycle/index.js";
export * as multibody from "./api/multibody/index.js";
export * as parameters from "./api/parameters/index.js";
export * as results from "./api/results/index.js";
export * as solver from "./api/solver/index.js";
