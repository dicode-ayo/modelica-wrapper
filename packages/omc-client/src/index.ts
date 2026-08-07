/**
 * @dicode/omc-client — public surface.
 *
 * Two consumption styles:
 *
 *   1. Class API (most callers):
 *
 *        import { OmcClient } from "@dicode/omc-client";
 *        const client = await OmcClient.create();
 *        const { version } = await client.getVersion();
 *
 *   2. Functional API (tree-shakable; compose your own CallContext):
 *
 *        import { getVersion } from "@dicode/omc-client/api/browsing";
 *        const result = await getVersion(myCtx, {});
 *
 * Each per-function module also exports `<Fn>InputSchema`, `<Fn>OutputSchema`,
 * and the inferred `<Fn>Input`/`<Fn>Output` types for callers that want to
 * pre-validate or generate UI from the schemas.
 */

// --- Class API ---
export { OmcClient, type OmcClientOptions } from "./client.js";

// --- Diagnostic record types (re-exported for VSCode-side mappers) ---
export {
  ErrorMessageSchema,
  type ErrorMessage,
} from "./api/browsing/getMessagesStringInternal.js";

// --- Generic dispatcher with runtime input + output validation ---
export {
  REGISTRY,
  omcFunctionNames,
  functionsByCategory,
  type OmcFnName,
  type OmcInput,
  type OmcOutput,
} from "./registry.js";

// --- Structured + plain-text help built on the registry ---
export {
  describeFunction,
  describeFunctionAsJsonSchema,
  renderFunctionHelp,
  renderCategoryHelp,
  renderOverview,
  type FieldInfo,
  type FunctionDescription,
  type FunctionJsonSchema,
  type JsonSchema,
} from "./help.js";

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
  ModelInstanceNotFullyLoadedError,
  parseModelInstanceOutput,
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
  moveWithin,
  PolygonShapeSchema,
  RectangleShapeSchema,
  EllipseShapeSchema,
  TextShapeSchema,
  BitmapShapeSchema,
  ShapeSchema,
  IconLayerSchema,
  PlacementSchema,
  PortDefSchema,
  ParameterDefSchema,
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
  type GraphicItem,
  type LineStyle,
  type FilledShape,
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
  type ParameterDef,
  type ClassDef,
  type ComponentInstance,
  type ConnectorInstance,
  type ConnectionEndpoint,
  type ConnectionLayout,
  type LabelLayout,
  type DiagramLayout,
  // ResultViewDoc (postprocessing *.omresults wire contract — types + schema
  // only; host I/O lives in extension, the variable tree in result-ui)
  ResultRefSchema,
  TraceSchema,
  PlotCardSchema,
  CardSchema,
  ResultViewDocSchema,
  emptyResultViewDoc,
  type ResultSource,
  type ResultRef,
  type Trace,
  type PlotCard,
  type Card,
  type ResultViewDoc,
} from "./_shared/index.js";

// --- ParameterModel (parameter-form producer output) ---
export {
  produceParameterModel,
  collectBaseUnits,
  DEFAULT_DIALOG_TAB,
  DEFAULT_DIALOG_GROUP,
  produceSimulationModel,
  SIMULATION_GROUP,
  SIMULATION_TAB,
  SOLVER_METHODS,
  DEFAULT_SOLVER_METHOD,
  OUTPUT_FORMATS,
  DEFAULT_OUTPUT_FORMAT,
  type ProduceParameterModelOptions,
  type ProduceSimulationModelOptions,
  type SolverMethod,
  type OutputFormat,
  type ParameterModel,
  type ParameterField,
  type ParameterFieldKind,
  type UnitOption,
  type UnitTable,
} from "./api/parameters-form/index.js";

// --- Lower-level transport / process / parser (advanced use) ---
export type { OmcCommand, OmcFunction } from "./commands.js";
export { OmcTransport } from "./transport.js";
export { spawnOmc, type OmcProcess } from "./process.js";
export { reapOrphanedOmcSessions, type ReapOptions } from "./orphans.js";
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

export {
  annotationGraphics,
  annotationCoordinateSystem,
  type CoordinateSystemFields,
} from "./api/diagram/annotation-layout.js";

export { shapeToRecord } from "./api/diagram/shape-serialize.js";

// --- Functional API (re-export by category) ---
export * as browsing from "./api/browsing/index.js";
export * as contents from "./api/contents/index.js";
export * as diagram from "./api/diagram/index.js";
export * as parametersForm from "./api/parameters-form/index.js";
export * as editing from "./api/editing/index.js";
export * as elements from "./api/elements/index.js";
export * as execution from "./api/execution/index.js";
export * as library from "./api/library/index.js";
export * as lifecycle from "./api/lifecycle/index.js";
export * as parameters from "./api/parameters/index.js";
export * as results from "./api/results/index.js";
export * as solver from "./api/solver/index.js";

export {
  evaluateExpression,
  expressionToString,
  chainScopes,
  prefixStrippingScope,
  recordScope,
  type EnumLiteralValue,
  type EvalScope,
  type EvalValue,
  type EvaluateOptions,
} from "./eval/index.js";
