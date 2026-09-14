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
 * There is one way in. A per-function module takes a `CallContext` and builds
 * its command from the input it is handed, trusting the schema to have run —
 * `invoke` is what runs it. Reaching those functions directly would skip it,
 * so they are not exported.
 *
 * `<Fn>InputSchema`, `<Fn>OutputSchema` and the inferred `<Fn>Input`/
 * `<Fn>Output` types are exported for callers that pre-validate or generate UI
 * from the schemas.
 */

// --- Class API ---
export {
  OmcClient,
  type MutationListener,
  type OmcClientOptions,
} from "./client.js";

// --- Mutation announcements (see client.onMutation) ---
export {
  isReadOnlyFunction,
  mutationFor,
  type MutatingFnName,
  type MutationScope,
  type OmcMutation,
} from "./mutation.js";

// --- Diagnostic record types (re-exported for VSCode-side mappers) ---
export {
  ErrorMessageSchema,
  type ErrorMessage,
} from "./api/browsing/getMessagesStringInternal.js";

// --- Generic dispatcher with runtime input + output validation ---
export {
  REGISTRY,
  isOmcFnName,
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
  describeFunctionInputAsJsonSchema,
  renderFunctionHelp,
  renderCategoryHelp,
  renderOverview,
  type FieldInfo,
  type FunctionDescription,
  type FunctionJsonSchema,
  type JsonSchema,
} from "./help.js";

// --- Declaring a class, then writing it out to a source tree ---
export {
  CLASS_KINDS,
  classSource,
  declareClass,
  qualifiedNameOf,
  resolveRootPackageParent,
  type ClassDeclaration,
  type ClassKind,
  type DeclareClient,
  type RootPackageClient,
} from "./declare-class.js";
export { pathExists } from "./fs-util.js";
export { boundedArray } from "./_shared/boundedArray.js";
export { fileOwnerClass, type FileOwnerClient } from "./file-owner.js";
export {
  isLikelyDiskPath,
  linkPersistedClass,
  persistClass,
  type PersistClient,
  type PersistResult,
  type SourceTree,
  type SourceWriter,
} from "./persist.js";
export {
  saveClass,
  type SaveClient,
  type SaveOptions,
  type SaveResult,
  type SavedClass,
  type SkippedClass,
} from "./save-class.js";

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
  classNameToFilePrefix,
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
  type ReplaceableConstraint,
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
  classNameOf,
  connectorPlacementKeywords,
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

export {
  ShapeIndexSchema,
  WriteClassGraphicsInputSchema,
  WriteCoordinateSystemSchema,
} from "./api/editing/writeClassGraphics.js";

/**
 * The api modules that transform a model instance rather than talk to OMC.
 * They take no `CallContext` and build no command, so nothing is skipped by
 * calling them directly. The ten that do build commands stay unexported.
 */
export * as diagram from "./api/diagram/index.js";
export * as parametersForm from "./api/parameters-form/index.js";

// Types a consumer needs that only a per-function module declares.
export type { ConvertUnitsOutput } from "./api/contents/index.js";

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
