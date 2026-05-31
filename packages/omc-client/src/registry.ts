/**
 * Registry of every OMC API function exposed by this package.
 *
 * Used by `OmcClient.invoke(name, input)` for generic, name-keyed dispatch
 * with both compile-time type-checking (via TypeScript indexed access on the
 * registry) and runtime input validation (via the per-function Zod schema).
 *
 * Direct method calls on `OmcClient` (e.g. `client.getClassInformation({...})`)
 * skip the runtime input validation step — TypeScript already catches misuse
 * at the call site. Use `invoke()` when input comes from an untrusted source
 * (RPC, JSON config, REPL, plugin sandbox).
 *
 * Adding a new function:
 *   1. Create the per-function file under `src/api/<category>/<fn>.ts`
 *   2. Add the OmcClient delegation method in `client.ts`
 *   3. Add an entry to REGISTRY below
 */

import { z } from "zod";

import type { CallContext } from "./_shared/callContext.js";
import * as browsing from "./api/browsing/index.js";
import * as contents from "./api/contents/index.js";
import * as editing from "./api/editing/index.js";
import * as elements from "./api/elements/index.js";
import * as execution from "./api/execution/index.js";
import * as library from "./api/library/index.js";
import * as lifecycle from "./api/lifecycle/index.js";
import * as parameters from "./api/parameters/index.js";
import * as results from "./api/results/index.js";
import * as solver from "./api/solver/index.js";

/**
 * Single registry entry: the implementation + its input AND output Zod schemas.
 *
 * `inputSchema` is typed as `z.ZodType<unknown>` because per-function input
 * schemas use `.optional().default(...)` — making the Zod input type (what
 * callers pass) and Zod output type (post-`.parse()`) different. We rely on
 * `OmcInput<K> = Parameters<entry.fn>[1]` to give callers the correct
 * pass-in shape; the schema is used for runtime validation only.
 *
 * `outputSchema` is typed (`z.ZodType<TOutput>`) because the function's
 * declared return type matches the schema's `.parse()` output exactly — no
 * `.default()` divergence on the output side. Exposed for external callers
 * (codegen, JSON-Schema export, contract tests).
 *
 * Output validation itself happens inside each per-function impl via
 * `parseOutput(<Fn>OutputSchema, ...)`. `invoke()` doesn't re-validate the
 * output — that would be a wasteful second pass over data already checked.
 */
interface RegistryEntry<TInput, TOutput> {
  fn: (ctx: CallContext, input: TInput) => Promise<TOutput>;
  inputSchema: z.ZodType<unknown>;
  outputSchema: z.ZodType<TOutput>;
  category: string;
  /**
   * Plain-English description of what the OMC function does, sourced from the
   * OpenModelica scripting documentation. Consumed by the MCP-generation
   * pipeline together with the JSON-Schema views of `inputSchema` and
   * `outputSchema` to produce MCP tool definitions.
   */
  description: string;
}

function entry<TInput, TOutput>(
  category: string,
  fn: (ctx: CallContext, input: TInput) => Promise<TOutput>,
  inputSchema: z.ZodType<unknown>,
  outputSchema: z.ZodType<TOutput>,
  description: string,
): RegistryEntry<TInput, TOutput> {
  return { fn, inputSchema, outputSchema, category, description };
}

export const REGISTRY = {
  // --- Browsing ---
  getVersion: entry(
    "browsing",
    browsing.getVersion,
    browsing.GetVersionInputSchema,
    browsing.GetVersionOutputSchema,
    browsing.GetVersionDescription,
  ),
  getClassNames: entry(
    "browsing",
    browsing.getClassNames,
    browsing.GetClassNamesInputSchema,
    browsing.GetClassNamesOutputSchema,
    browsing.GetClassNamesDescription,
  ),
  searchClassNames: entry(
    "browsing",
    browsing.searchClassNames,
    browsing.SearchClassNamesInputSchema,
    browsing.SearchClassNamesOutputSchema,
    browsing.SearchClassNamesDescription,
  ),
  getClassInformation: entry(
    "browsing",
    browsing.getClassInformation,
    browsing.GetClassInformationInputSchema,
    browsing.GetClassInformationOutputSchema,
    browsing.GetClassInformationDescription,
  ),
  isPackage: entry(
    "browsing",
    browsing.isPackage,
    browsing.IsPackageInputSchema,
    browsing.IsPackageOutputSchema,
    browsing.IsPackageDescription,
  ),
  getInheritanceCount: entry(
    "browsing",
    browsing.getInheritanceCount,
    browsing.GetInheritanceCountInputSchema,
    browsing.GetInheritanceCountOutputSchema,
    browsing.GetInheritanceCountDescription,
  ),
  getInheritedClasses: entry(
    "browsing",
    browsing.getInheritedClasses,
    browsing.GetInheritedClassesInputSchema,
    browsing.GetInheritedClassesOutputSchema,
    browsing.GetInheritedClassesDescription,
  ),
  getUses: entry(
    "browsing",
    browsing.getUses,
    browsing.GetUsesInputSchema,
    browsing.GetUsesOutputSchema,
    browsing.GetUsesDescription,
  ),
  existClass: entry(
    "browsing",
    browsing.existClass,
    browsing.ExistClassInputSchema,
    browsing.ExistClassOutputSchema,
    browsing.ExistClassDescription,
  ),
  getErrorString: entry(
    "browsing",
    browsing.getErrorString,
    browsing.GetErrorStringInputSchema,
    browsing.GetErrorStringOutputSchema,
    browsing.GetErrorStringDescription,
  ),
  getMessagesStringInternal: entry(
    "browsing",
    browsing.getMessagesStringInternal,
    browsing.GetMessagesStringInternalInputSchema,
    browsing.GetMessagesStringInternalOutputSchema,
    browsing.GetMessagesStringInternalDescription,
  ),
  existModel: entry(
    "browsing",
    browsing.existModel,
    browsing.ExistModelInputSchema,
    browsing.ExistModelOutputSchema,
    browsing.ExistModelDescription,
  ),
  existPackage: entry(
    "browsing",
    browsing.existPackage,
    browsing.ExistPackageInputSchema,
    browsing.ExistPackageOutputSchema,
    browsing.ExistPackageDescription,
  ),
  getClassRestriction: entry(
    "browsing",
    browsing.getClassRestriction,
    browsing.GetClassRestrictionInputSchema,
    browsing.GetClassRestrictionOutputSchema,
    browsing.GetClassRestrictionDescription,
  ),
  getClassComment: entry(
    "browsing",
    browsing.getClassComment,
    browsing.GetClassCommentInputSchema,
    browsing.GetClassCommentOutputSchema,
    browsing.GetClassCommentDescription,
  ),
  isType: entry(
    "browsing",
    browsing.isType,
    browsing.IsTypeInputSchema,
    browsing.IsTypeOutputSchema,
    browsing.IsTypeDescription,
  ),
  isClass: entry(
    "browsing",
    browsing.isClass,
    browsing.IsClassInputSchema,
    browsing.IsClassOutputSchema,
    browsing.IsClassDescription,
  ),
  isRecord: entry(
    "browsing",
    browsing.isRecord,
    browsing.IsRecordInputSchema,
    browsing.IsRecordOutputSchema,
    browsing.IsRecordDescription,
  ),
  isBlock: entry(
    "browsing",
    browsing.isBlock,
    browsing.IsBlockInputSchema,
    browsing.IsBlockOutputSchema,
    browsing.IsBlockDescription,
  ),
  isFunction: entry(
    "browsing",
    browsing.isFunction,
    browsing.IsFunctionInputSchema,
    browsing.IsFunctionOutputSchema,
    browsing.IsFunctionDescription,
  ),
  isModel: entry(
    "browsing",
    browsing.isModel,
    browsing.IsModelInputSchema,
    browsing.IsModelOutputSchema,
    browsing.IsModelDescription,
  ),
  isConnector: entry(
    "browsing",
    browsing.isConnector,
    browsing.IsConnectorInputSchema,
    browsing.IsConnectorOutputSchema,
    browsing.IsConnectorDescription,
  ),
  isPartial: entry(
    "browsing",
    browsing.isPartial,
    browsing.IsPartialInputSchema,
    browsing.IsPartialOutputSchema,
    browsing.IsPartialDescription,
  ),
  isReplaceable: entry(
    "browsing",
    browsing.isReplaceable,
    browsing.IsReplaceableInputSchema,
    browsing.IsReplaceableOutputSchema,
    browsing.IsReplaceableDescription,
  ),
  isProtectedClass: entry(
    "browsing",
    browsing.isProtectedClass,
    browsing.IsProtectedClassInputSchema,
    browsing.IsProtectedClassOutputSchema,
    browsing.IsProtectedClassDescription,
  ),
  isEnumeration: entry(
    "browsing",
    browsing.isEnumeration,
    browsing.IsEnumerationInputSchema,
    browsing.IsEnumerationOutputSchema,
    browsing.IsEnumerationDescription,
  ),
  isConstant: entry(
    "browsing",
    browsing.isConstant,
    browsing.IsConstantInputSchema,
    browsing.IsConstantOutputSchema,
    browsing.IsConstantDescription,
  ),
  isParameter: entry(
    "browsing",
    browsing.isParameter,
    browsing.IsParameterInputSchema,
    browsing.IsParameterOutputSchema,
    browsing.IsParameterDescription,
  ),
  isProtected: entry(
    "browsing",
    browsing.isProtected,
    browsing.IsProtectedInputSchema,
    browsing.IsProtectedOutputSchema,
    browsing.IsProtectedDescription,
  ),
  isRedeclare: entry(
    "browsing",
    browsing.isRedeclare,
    browsing.IsRedeclareInputSchema,
    browsing.IsRedeclareOutputSchema,
    browsing.IsRedeclareDescription,
  ),
  isPrimitive: entry(
    "browsing",
    browsing.isPrimitive,
    browsing.IsPrimitiveInputSchema,
    browsing.IsPrimitiveOutputSchema,
    browsing.IsPrimitiveDescription,
  ),
  isOperator: entry(
    "browsing",
    browsing.isOperator,
    browsing.IsOperatorInputSchema,
    browsing.IsOperatorOutputSchema,
    browsing.IsOperatorDescription,
  ),
  isOperatorFunction: entry(
    "browsing",
    browsing.isOperatorFunction,
    browsing.IsOperatorFunctionInputSchema,
    browsing.IsOperatorFunctionOutputSchema,
    browsing.IsOperatorFunctionDescription,
  ),
  isOperatorRecord: entry(
    "browsing",
    browsing.isOperatorRecord,
    browsing.IsOperatorRecordInputSchema,
    browsing.IsOperatorRecordOutputSchema,
    browsing.IsOperatorRecordDescription,
  ),
  isOptimization: entry(
    "browsing",
    browsing.isOptimization,
    browsing.IsOptimizationInputSchema,
    browsing.IsOptimizationOutputSchema,
    browsing.IsOptimizationDescription,
  ),
  getEnumerationLiterals: entry(
    "browsing",
    browsing.getEnumerationLiterals,
    browsing.GetEnumerationLiteralsInputSchema,
    browsing.GetEnumerationLiteralsOutputSchema,
    browsing.GetEnumerationLiteralsDescription,
  ),
  getReplaceableChoices: entry(
    "browsing",
    browsing.getReplaceableChoices,
    browsing.GetReplaceableChoicesInputSchema,
    browsing.GetReplaceableChoicesOutputSchema,
    browsing.GetReplaceableChoicesDescription,
  ),
  extendsFrom: entry(
    "browsing",
    browsing.extendsFrom,
    browsing.ExtendsFromInputSchema,
    browsing.ExtendsFromOutputSchema,
    browsing.ExtendsFromDescription,
  ),
  getAllSubtypeOf: entry(
    "browsing",
    browsing.getAllSubtypeOf,
    browsing.GetAllSubtypeOfInputSchema,
    browsing.GetAllSubtypeOfOutputSchema,
    browsing.GetAllSubtypeOfDescription,
  ),
  classAnnotationExists: entry(
    "browsing",
    browsing.classAnnotationExists,
    browsing.ClassAnnotationExistsInputSchema,
    browsing.ClassAnnotationExistsOutputSchema,
    browsing.ClassAnnotationExistsDescription,
  ),
  getNthInheritedClass: entry(
    "browsing",
    browsing.getNthInheritedClass,
    browsing.GetNthInheritedClassInputSchema,
    browsing.GetNthInheritedClassOutputSchema,
    browsing.GetNthInheritedClassDescription,
  ),
  isShortDefinition: entry(
    "browsing",
    browsing.isShortDefinition,
    browsing.IsShortDefinitionInputSchema,
    browsing.IsShortDefinitionOutputSchema,
    browsing.IsShortDefinitionDescription,
  ),

  // --- Reading model contents ---
  getComponents: entry(
    "contents",
    contents.getComponents,
    contents.GetComponentsInputSchema,
    contents.GetComponentsOutputSchema,
    contents.GetComponentsDescription,
  ),
  getComponentAnnotations: entry(
    "contents",
    contents.getComponentAnnotations,
    contents.GetComponentAnnotationsInputSchema,
    contents.GetComponentAnnotationsOutputSchema,
    contents.GetComponentAnnotationsDescription,
  ),
  getConnectionCount: entry(
    "contents",
    contents.getConnectionCount,
    contents.GetConnectionCountInputSchema,
    contents.GetConnectionCountOutputSchema,
    contents.GetConnectionCountDescription,
  ),
  getNthConnection: entry(
    "contents",
    contents.getNthConnection,
    contents.GetNthConnectionInputSchema,
    contents.GetNthConnectionOutputSchema,
    contents.GetNthConnectionDescription,
  ),
  getNthConnectionAnnotation: entry(
    "contents",
    contents.getNthConnectionAnnotation,
    contents.GetNthConnectionAnnotationInputSchema,
    contents.GetNthConnectionAnnotationOutputSchema,
    contents.GetNthConnectionAnnotationDescription,
  ),
  getTransitions: entry(
    "contents",
    contents.getTransitions,
    contents.GetTransitionsInputSchema,
    contents.GetTransitionsOutputSchema,
    contents.GetTransitionsDescription,
  ),
  getInitialStates: entry(
    "contents",
    contents.getInitialStates,
    contents.GetInitialStatesInputSchema,
    contents.GetInitialStatesOutputSchema,
    contents.GetInitialStatesDescription,
  ),
  getIconAnnotation: entry(
    "contents",
    contents.getIconAnnotation,
    contents.GetIconAnnotationInputSchema,
    contents.GetIconAnnotationOutputSchema,
    contents.GetIconAnnotationDescription,
  ),
  getDiagramAnnotation: entry(
    "contents",
    contents.getDiagramAnnotation,
    contents.GetDiagramAnnotationInputSchema,
    contents.GetDiagramAnnotationOutputSchema,
    contents.GetDiagramAnnotationDescription,
  ),
  getDocumentationAnnotation: entry(
    "contents",
    contents.getDocumentationAnnotation,
    contents.GetDocumentationAnnotationInputSchema,
    contents.GetDocumentationAnnotationOutputSchema,
    contents.GetDocumentationAnnotationDescription,
  ),
  listFile: entry(
    "contents",
    contents.listFile,
    contents.ListFileInputSchema,
    contents.ListFileOutputSchema,
    contents.ListFileDescription,
  ),
  instantiateModel: entry(
    "contents",
    contents.instantiateModel,
    contents.InstantiateModelInputSchema,
    contents.InstantiateModelOutputSchema,
    contents.InstantiateModelDescription,
  ),
  getModelInstance: entry(
    "contents",
    contents.getModelInstance,
    contents.GetModelInstanceInputSchema,
    contents.GetModelInstanceOutputSchema,
    contents.GetModelInstanceDescription,
  ),
  getModelInstanceAnnotation: entry(
    "contents",
    contents.getModelInstanceAnnotation,
    contents.GetModelInstanceAnnotationInputSchema,
    contents.GetModelInstanceAnnotationOutputSchema,
    contents.GetModelInstanceAnnotationDescription,
  ),
  modifierToJSON: entry(
    "contents",
    contents.modifierToJSON,
    contents.ModifierToJSONInputSchema,
    contents.ModifierToJSONOutputSchema,
    contents.ModifierToJSONDescription,
  ),
  getConnectionList: entry(
    "contents",
    contents.getConnectionList,
    contents.GetConnectionListInputSchema,
    contents.GetConnectionListOutputSchema,
    contents.GetConnectionListDescription,
  ),
  getNthConnector: entry(
    "contents",
    contents.getNthConnector,
    contents.GetNthConnectorInputSchema,
    contents.GetNthConnectorOutputSchema,
    contents.GetNthConnectorDescription,
  ),
  getNthConnectorIconAnnotation: entry(
    "contents",
    contents.getNthConnectorIconAnnotation,
    contents.GetNthConnectorIconAnnotationInputSchema,
    contents.GetNthConnectorIconAnnotationOutputSchema,
    contents.GetNthConnectorIconAnnotationDescription,
  ),
  getConnectorCount: entry(
    "contents",
    contents.getConnectorCount,
    contents.GetConnectorCountInputSchema,
    contents.GetConnectorCountOutputSchema,
    contents.GetConnectorCountDescription,
  ),
  getNthInheritedClassIconMapAnnotation: entry(
    "contents",
    contents.getNthInheritedClassIconMapAnnotation,
    contents.GetNthInheritedClassIconMapAnnotationInputSchema,
    contents.GetNthInheritedClassIconMapAnnotationOutputSchema,
    contents.GetNthInheritedClassIconMapAnnotationDescription,
  ),
  getNthInheritedClassDiagramMapAnnotation: entry(
    "contents",
    contents.getNthInheritedClassDiagramMapAnnotation,
    contents.GetNthInheritedClassDiagramMapAnnotationInputSchema,
    contents.GetNthInheritedClassDiagramMapAnnotationOutputSchema,
    contents.GetNthInheritedClassDiagramMapAnnotationDescription,
  ),
  getDefaultComponentName: entry(
    "contents",
    contents.getDefaultComponentName,
    contents.GetDefaultComponentNameInputSchema,
    contents.GetDefaultComponentNameOutputSchema,
    contents.GetDefaultComponentNameDescription,
  ),
  getDefaultComponentPrefixes: entry(
    "contents",
    contents.getDefaultComponentPrefixes,
    contents.GetDefaultComponentPrefixesInputSchema,
    contents.GetDefaultComponentPrefixesOutputSchema,
    contents.GetDefaultComponentPrefixesDescription,
  ),
  getComponentComment: entry(
    "contents",
    contents.getComponentComment,
    contents.GetComponentCommentInputSchema,
    contents.GetComponentCommentOutputSchema,
    contents.GetComponentCommentDescription,
  ),
  getInstantiatedParametersAndValues: entry(
    "contents",
    contents.getInstantiatedParametersAndValues,
    contents.GetInstantiatedParametersAndValuesInputSchema,
    contents.GetInstantiatedParametersAndValuesOutputSchema,
    contents.GetInstantiatedParametersAndValuesDescription,
  ),
  getAnnotationNamedModifiers: entry(
    "contents",
    contents.getAnnotationNamedModifiers,
    contents.GetAnnotationNamedModifiersInputSchema,
    contents.GetAnnotationNamedModifiersOutputSchema,
    contents.GetAnnotationNamedModifiersDescription,
  ),
  getAnnotationModifierValue: entry(
    "contents",
    contents.getAnnotationModifierValue,
    contents.GetAnnotationModifierValueInputSchema,
    contents.GetAnnotationModifierValueOutputSchema,
    contents.GetAnnotationModifierValueDescription,
  ),
  getComponentCount: entry(
    "contents",
    contents.getComponentCount,
    contents.GetComponentCountInputSchema,
    contents.GetComponentCountOutputSchema,
    contents.GetComponentCountDescription,
  ),
  getNthComponent: entry(
    "contents",
    contents.getNthComponent,
    contents.GetNthComponentInputSchema,
    contents.GetNthComponentOutputSchema,
    contents.GetNthComponentDescription,
  ),
  getNthComponentAnnotation: entry(
    "contents",
    contents.getNthComponentAnnotation,
    contents.GetNthComponentAnnotationInputSchema,
    contents.GetNthComponentAnnotationOutputSchema,
    contents.GetNthComponentAnnotationDescription,
  ),
  getNthComponentCondition: entry(
    "contents",
    contents.getNthComponentCondition,
    contents.GetNthComponentConditionInputSchema,
    contents.GetNthComponentConditionOutputSchema,
    contents.GetNthComponentConditionDescription,
  ),
  getNthComponentModification: entry(
    "contents",
    contents.getNthComponentModification,
    contents.GetNthComponentModificationInputSchema,
    contents.GetNthComponentModificationOutputSchema,
    contents.GetNthComponentModificationDescription,
  ),
  getAnnotationCount: entry(
    "contents",
    contents.getAnnotationCount,
    contents.GetAnnotationCountInputSchema,
    contents.GetAnnotationCountOutputSchema,
    contents.GetAnnotationCountDescription,
  ),
  getNthAnnotationString: entry(
    "contents",
    contents.getNthAnnotationString,
    contents.GetNthAnnotationStringInputSchema,
    contents.GetNthAnnotationStringOutputSchema,
    contents.GetNthAnnotationStringDescription,
  ),
  getAlgorithmCount: entry(
    "contents",
    contents.getAlgorithmCount,
    contents.GetAlgorithmCountInputSchema,
    contents.GetAlgorithmCountOutputSchema,
    contents.GetAlgorithmCountDescription,
  ),
  getNthAlgorithm: entry(
    "contents",
    contents.getNthAlgorithm,
    contents.GetNthAlgorithmInputSchema,
    contents.GetNthAlgorithmOutputSchema,
    contents.GetNthAlgorithmDescription,
  ),
  getAlgorithmItemsCount: entry(
    "contents",
    contents.getAlgorithmItemsCount,
    contents.GetAlgorithmItemsCountInputSchema,
    contents.GetAlgorithmItemsCountOutputSchema,
    contents.GetAlgorithmItemsCountDescription,
  ),
  getNthAlgorithmItem: entry(
    "contents",
    contents.getNthAlgorithmItem,
    contents.GetNthAlgorithmItemInputSchema,
    contents.GetNthAlgorithmItemOutputSchema,
    contents.GetNthAlgorithmItemDescription,
  ),
  getInitialAlgorithmCount: entry(
    "contents",
    contents.getInitialAlgorithmCount,
    contents.GetInitialAlgorithmCountInputSchema,
    contents.GetInitialAlgorithmCountOutputSchema,
    contents.GetInitialAlgorithmCountDescription,
  ),
  getNthInitialAlgorithm: entry(
    "contents",
    contents.getNthInitialAlgorithm,
    contents.GetNthInitialAlgorithmInputSchema,
    contents.GetNthInitialAlgorithmOutputSchema,
    contents.GetNthInitialAlgorithmDescription,
  ),
  getInitialAlgorithmItemsCount: entry(
    "contents",
    contents.getInitialAlgorithmItemsCount,
    contents.GetInitialAlgorithmItemsCountInputSchema,
    contents.GetInitialAlgorithmItemsCountOutputSchema,
    contents.GetInitialAlgorithmItemsCountDescription,
  ),
  getNthInitialAlgorithmItem: entry(
    "contents",
    contents.getNthInitialAlgorithmItem,
    contents.GetNthInitialAlgorithmItemInputSchema,
    contents.GetNthInitialAlgorithmItemOutputSchema,
    contents.GetNthInitialAlgorithmItemDescription,
  ),
  getNthEquation: entry(
    "contents",
    contents.getNthEquation,
    contents.GetNthEquationInputSchema,
    contents.GetNthEquationOutputSchema,
    contents.GetNthEquationDescription,
  ),
  getNthEquationItem: entry(
    "contents",
    contents.getNthEquationItem,
    contents.GetNthEquationItemInputSchema,
    contents.GetNthEquationItemOutputSchema,
    contents.GetNthEquationItemDescription,
  ),
  getInitialEquationCount: entry(
    "contents",
    contents.getInitialEquationCount,
    contents.GetInitialEquationCountInputSchema,
    contents.GetInitialEquationCountOutputSchema,
    contents.GetInitialEquationCountDescription,
  ),
  getNthInitialEquation: entry(
    "contents",
    contents.getNthInitialEquation,
    contents.GetNthInitialEquationInputSchema,
    contents.GetNthInitialEquationOutputSchema,
    contents.GetNthInitialEquationDescription,
  ),
  getInitialEquationItemsCount: entry(
    "contents",
    contents.getInitialEquationItemsCount,
    contents.GetInitialEquationItemsCountInputSchema,
    contents.GetInitialEquationItemsCountOutputSchema,
    contents.GetInitialEquationItemsCountDescription,
  ),
  getNthInitialEquationItem: entry(
    "contents",
    contents.getNthInitialEquationItem,
    contents.GetNthInitialEquationItemInputSchema,
    contents.GetNthInitialEquationItemOutputSchema,
    contents.GetNthInitialEquationItemDescription,
  ),
  getImportCount: entry(
    "contents",
    contents.getImportCount,
    contents.GetImportCountInputSchema,
    contents.GetImportCountOutputSchema,
    contents.GetImportCountDescription,
  ),
  getNthImport: entry(
    "contents",
    contents.getNthImport,
    contents.GetNthImportInputSchema,
    contents.GetNthImportOutputSchema,
    contents.GetNthImportDescription,
  ),
  convertUnits: entry(
    "contents",
    contents.convertUnits,
    contents.ConvertUnitsInputSchema,
    contents.ConvertUnitsOutputSchema,
    contents.ConvertUnitsDescription,
  ),
  getDerivedUnits: entry(
    "contents",
    contents.getDerivedUnits,
    contents.GetDerivedUnitsInputSchema,
    contents.GetDerivedUnitsOutputSchema,
    contents.GetDerivedUnitsDescription,
  ),
  uriToFilename: entry(
    "contents",
    contents.uriToFilename,
    contents.UriToFilenameInputSchema,
    contents.UriToFilenameOutputSchema,
    contents.UriToFilenameDescription,
  ),
  qualifyPath: entry(
    "contents",
    contents.qualifyPath,
    contents.QualifyPathInputSchema,
    contents.QualifyPathOutputSchema,
    contents.QualifyPathDescription,
  ),

  // --- Lifecycle ---
  loadFile: entry(
    "lifecycle",
    lifecycle.loadFile,
    lifecycle.LoadFileInputSchema,
    lifecycle.LoadFileOutputSchema,
    lifecycle.LoadFileDescription,
  ),
  loadString: entry(
    "lifecycle",
    lifecycle.loadString,
    lifecycle.LoadStringInputSchema,
    lifecycle.LoadStringOutputSchema,
    lifecycle.LoadStringDescription,
  ),
  loadModel: entry(
    "lifecycle",
    lifecycle.loadModel,
    lifecycle.LoadModelInputSchema,
    lifecycle.LoadModelOutputSchema,
    lifecycle.LoadModelDescription,
  ),
  parseFile: entry(
    "lifecycle",
    lifecycle.parseFile,
    lifecycle.ParseFileInputSchema,
    lifecycle.ParseFileOutputSchema,
    lifecycle.ParseFileDescription,
  ),
  parseString: entry(
    "lifecycle",
    lifecycle.parseString,
    lifecycle.ParseStringInputSchema,
    lifecycle.ParseStringOutputSchema,
    lifecycle.ParseStringDescription,
  ),
  newModel: entry(
    "lifecycle",
    lifecycle.newModel,
    lifecycle.NewModelInputSchema,
    lifecycle.NewModelOutputSchema,
    lifecycle.NewModelDescription,
  ),
  renameClass: entry(
    "lifecycle",
    lifecycle.renameClass,
    lifecycle.RenameClassInputSchema,
    lifecycle.RenameClassOutputSchema,
    lifecycle.RenameClassDescription,
  ),
  deleteClass: entry(
    "lifecycle",
    lifecycle.deleteClass,
    lifecycle.DeleteClassInputSchema,
    lifecycle.DeleteClassOutputSchema,
    lifecycle.DeleteClassDescription,
  ),
  copyClass: entry(
    "lifecycle",
    lifecycle.copyClass,
    lifecycle.CopyClassInputSchema,
    lifecycle.CopyClassOutputSchema,
    lifecycle.CopyClassDescription,
  ),
  moveClass: entry(
    "lifecycle",
    lifecycle.moveClass,
    lifecycle.MoveClassInputSchema,
    lifecycle.MoveClassOutputSchema,
    lifecycle.MoveClassDescription,
  ),
  moveClassToTop: entry(
    "lifecycle",
    lifecycle.moveClassToTop,
    lifecycle.MoveClassToTopInputSchema,
    lifecycle.MoveClassToTopOutputSchema,
    lifecycle.MoveClassToTopDescription,
  ),
  moveClassToBottom: entry(
    "lifecycle",
    lifecycle.moveClassToBottom,
    lifecycle.MoveClassToBottomInputSchema,
    lifecycle.MoveClassToBottomOutputSchema,
    lifecycle.MoveClassToBottomDescription,
  ),
  getSourceFile: entry(
    "lifecycle",
    lifecycle.getSourceFile,
    lifecycle.GetSourceFileInputSchema,
    lifecycle.GetSourceFileOutputSchema,
    lifecycle.GetSourceFileDescription,
  ),
  setSourceFile: entry(
    "lifecycle",
    lifecycle.setSourceFile,
    lifecycle.SetSourceFileInputSchema,
    lifecycle.SetSourceFileOutputSchema,
    lifecycle.SetSourceFileDescription,
  ),
  diffModelicaFileListings: entry(
    "lifecycle",
    lifecycle.diffModelicaFileListings,
    lifecycle.DiffModelicaFileListingsInputSchema,
    lifecycle.DiffModelicaFileListingsOutputSchema,
    lifecycle.DiffModelicaFileListingsDescription,
  ),
  save: entry(
    "lifecycle",
    lifecycle.save,
    lifecycle.SaveInputSchema,
    lifecycle.SaveOutputSchema,
    lifecycle.SaveDescription,
  ),
  cd: entry(
    "lifecycle",
    lifecycle.cd,
    lifecycle.CdInputSchema,
    lifecycle.CdOutputSchema,
    lifecycle.CdDescription,
  ),
  loadClassContentString: entry(
    "lifecycle",
    lifecycle.loadClassContentString,
    lifecycle.LoadClassContentStringInputSchema,
    lifecycle.LoadClassContentStringOutputSchema,
    lifecycle.LoadClassContentStringDescription,
  ),

  // --- Parameters & modifiers ---
  getParameterValue: entry(
    "parameters",
    parameters.getParameterValue,
    parameters.GetParameterValueInputSchema,
    parameters.GetParameterValueOutputSchema,
    parameters.GetParameterValueDescription,
  ),
  getComponentModifierNames: entry(
    "parameters",
    parameters.getComponentModifierNames,
    parameters.GetComponentModifierNamesInputSchema,
    parameters.GetComponentModifierNamesOutputSchema,
    parameters.GetComponentModifierNamesDescription,
  ),
  getComponentModifierValue: entry(
    "parameters",
    parameters.getComponentModifierValue,
    parameters.GetComponentModifierValueInputSchema,
    parameters.GetComponentModifierValueOutputSchema,
    parameters.GetComponentModifierValueDescription,
  ),
  getComponentModifierValues: entry(
    "parameters",
    parameters.getComponentModifierValues,
    parameters.GetComponentModifierValuesInputSchema,
    parameters.GetComponentModifierValuesOutputSchema,
    parameters.GetComponentModifierValuesDescription,
  ),
  setComponentModifierValue: entry(
    "parameters",
    parameters.setComponentModifierValue,
    parameters.SetComponentModifierValueInputSchema,
    parameters.SetComponentModifierValueOutputSchema,
    parameters.SetComponentModifierValueDescription,
  ),
  removeComponentModifiers: entry(
    "parameters",
    parameters.removeComponentModifiers,
    parameters.RemoveComponentModifiersInputSchema,
    parameters.RemoveComponentModifiersOutputSchema,
    parameters.RemoveComponentModifiersDescription,
  ),
  getExtendsModifierNames: entry(
    "parameters",
    parameters.getExtendsModifierNames,
    parameters.GetExtendsModifierNamesInputSchema,
    parameters.GetExtendsModifierNamesOutputSchema,
    parameters.GetExtendsModifierNamesDescription,
  ),
  getExtendsModifierValue: entry(
    "parameters",
    parameters.getExtendsModifierValue,
    parameters.GetExtendsModifierValueInputSchema,
    parameters.GetExtendsModifierValueOutputSchema,
    parameters.GetExtendsModifierValueDescription,
  ),
  setExtendsModifierValue: entry(
    "parameters",
    parameters.setExtendsModifierValue,
    parameters.SetExtendsModifierValueInputSchema,
    parameters.SetExtendsModifierValueOutputSchema,
    parameters.SetExtendsModifierValueDescription,
  ),
  getParameterNames: entry(
    "parameters",
    parameters.getParameterNames,
    parameters.GetParameterNamesInputSchema,
    parameters.GetParameterNamesOutputSchema,
    parameters.GetParameterNamesDescription,
  ),
  setParameterValue: entry(
    "parameters",
    parameters.setParameterValue,
    parameters.SetParameterValueInputSchema,
    parameters.SetParameterValueOutputSchema,
    parameters.SetParameterValueDescription,
  ),
  removeExtendsModifiers: entry(
    "parameters",
    parameters.removeExtendsModifiers,
    parameters.RemoveExtendsModifiersInputSchema,
    parameters.RemoveExtendsModifiersOutputSchema,
    parameters.RemoveExtendsModifiersDescription,
  ),
  getDerivedClassModifierNames: entry(
    "parameters",
    parameters.getDerivedClassModifierNames,
    parameters.GetDerivedClassModifierNamesInputSchema,
    parameters.GetDerivedClassModifierNamesOutputSchema,
    parameters.GetDerivedClassModifierNamesDescription,
  ),
  getDerivedClassModifierValue: entry(
    "parameters",
    parameters.getDerivedClassModifierValue,
    parameters.GetDerivedClassModifierValueInputSchema,
    parameters.GetDerivedClassModifierValueOutputSchema,
    parameters.GetDerivedClassModifierValueDescription,
  ),
  isExtendsModifierFinal: entry(
    "parameters",
    parameters.isExtendsModifierFinal,
    parameters.IsExtendsModifierFinalInputSchema,
    parameters.IsExtendsModifierFinalOutputSchema,
    parameters.IsExtendsModifierFinalDescription,
  ),
  setExtendsModifier: entry(
    "parameters",
    parameters.setExtendsModifier,
    parameters.SetExtendsModifierInputSchema,
    parameters.SetExtendsModifierOutputSchema,
    parameters.SetExtendsModifierDescription,
  ),

  // --- Elements (modern Component* generalization) ---
  getElements: entry(
    "elements",
    elements.getElements,
    elements.GetElementsInputSchema,
    elements.GetElementsOutputSchema,
    elements.GetElementsDescription,
  ),
  getElementsInfo: entry(
    "elements",
    elements.getElementsInfo,
    elements.GetElementsInfoInputSchema,
    elements.GetElementsInfoOutputSchema,
    elements.GetElementsInfoDescription,
  ),
  getElementAnnotation: entry(
    "elements",
    elements.getElementAnnotation,
    elements.GetElementAnnotationInputSchema,
    elements.GetElementAnnotationOutputSchema,
    elements.GetElementAnnotationDescription,
  ),
  getElementAnnotations: entry(
    "elements",
    elements.getElementAnnotations,
    elements.GetElementAnnotationsInputSchema,
    elements.GetElementAnnotationsOutputSchema,
    elements.GetElementAnnotationsDescription,
  ),
  getElementModifierNames: entry(
    "elements",
    elements.getElementModifierNames,
    elements.GetElementModifierNamesInputSchema,
    elements.GetElementModifierNamesOutputSchema,
    elements.GetElementModifierNamesDescription,
  ),
  getElementModifierValue: entry(
    "elements",
    elements.getElementModifierValue,
    elements.GetElementModifierValueInputSchema,
    elements.GetElementModifierValueOutputSchema,
    elements.GetElementModifierValueDescription,
  ),
  getElementModifierValues: entry(
    "elements",
    elements.getElementModifierValues,
    elements.GetElementModifierValuesInputSchema,
    elements.GetElementModifierValuesOutputSchema,
    elements.GetElementModifierValuesDescription,
  ),
  setElementModifierValue: entry(
    "elements",
    elements.setElementModifierValue,
    elements.SetElementModifierValueInputSchema,
    elements.SetElementModifierValueOutputSchema,
    elements.SetElementModifierValueDescription,
  ),
  setElementAnnotation: entry(
    "elements",
    elements.setElementAnnotation,
    elements.SetElementAnnotationInputSchema,
    elements.SetElementAnnotationOutputSchema,
    elements.SetElementAnnotationDescription,
  ),
  setElementType: entry(
    "elements",
    elements.setElementType,
    elements.SetElementTypeInputSchema,
    elements.SetElementTypeOutputSchema,
    elements.SetElementTypeDescription,
  ),
  removeElementModifiers: entry(
    "elements",
    elements.removeElementModifiers,
    elements.RemoveElementModifiersInputSchema,
    elements.RemoveElementModifiersOutputSchema,
    elements.RemoveElementModifiersDescription,
  ),

  // --- Library / package management ---
  getAvailableLibraries: entry(
    "library",
    library.getAvailableLibraries,
    library.GetAvailableLibrariesInputSchema,
    library.GetAvailableLibrariesOutputSchema,
    library.GetAvailableLibrariesDescription,
  ),
  getAvailableLibraryVersions: entry(
    "library",
    library.getAvailableLibraryVersions,
    library.GetAvailableLibraryVersionsInputSchema,
    library.GetAvailableLibraryVersionsOutputSchema,
    library.GetAvailableLibraryVersionsDescription,
  ),
  getAvailablePackageVersions: entry(
    "library",
    library.getAvailablePackageVersions,
    library.GetAvailablePackageVersionsInputSchema,
    library.GetAvailablePackageVersionsOutputSchema,
    library.GetAvailablePackageVersionsDescription,
  ),
  getAvailablePackageConversionsFrom: entry(
    "library",
    library.getAvailablePackageConversionsFrom,
    library.GetAvailablePackageConversionsFromInputSchema,
    library.GetAvailablePackageConversionsFromOutputSchema,
    library.GetAvailablePackageConversionsFromDescription,
  ),
  getAvailablePackageConversionsTo: entry(
    "library",
    library.getAvailablePackageConversionsTo,
    library.GetAvailablePackageConversionsToInputSchema,
    library.GetAvailablePackageConversionsToOutputSchema,
    library.GetAvailablePackageConversionsToDescription,
  ),
  getConversionsFromVersions: entry(
    "library",
    library.getConversionsFromVersions,
    library.GetConversionsFromVersionsInputSchema,
    library.GetConversionsFromVersionsOutputSchema,
    library.GetConversionsFromVersionsDescription,
  ),
  installPackage: entry(
    "library",
    library.installPackage,
    library.InstallPackageInputSchema,
    library.InstallPackageOutputSchema,
    library.InstallPackageDescription,
  ),
  updatePackageIndex: entry(
    "library",
    library.updatePackageIndex,
    library.UpdatePackageIndexInputSchema,
    library.UpdatePackageIndexOutputSchema,
    library.UpdatePackageIndexDescription,
  ),
  upgradeInstalledPackages: entry(
    "library",
    library.upgradeInstalledPackages,
    library.UpgradeInstalledPackagesInputSchema,
    library.UpgradeInstalledPackagesOutputSchema,
    library.UpgradeInstalledPackagesDescription,
  ),
  getLoadedLibraries: entry(
    "library",
    library.getLoadedLibraries,
    library.GetLoadedLibrariesInputSchema,
    library.GetLoadedLibrariesOutputSchema,
    library.GetLoadedLibrariesDescription,
  ),
  getPackages: entry(
    "library",
    library.getPackages,
    library.GetPackagesInputSchema,
    library.GetPackagesOutputSchema,
    library.GetPackagesDescription,
  ),
  loadFiles: entry(
    "library",
    library.loadFiles,
    library.LoadFilesInputSchema,
    library.LoadFilesOutputSchema,
    library.LoadFilesDescription,
  ),

  // --- Editing ---
  addComponent: entry(
    "editing",
    editing.addComponent,
    editing.AddComponentInputSchema,
    editing.AddComponentOutputSchema,
    editing.AddComponentDescription,
  ),
  deleteComponent: entry(
    "editing",
    editing.deleteComponent,
    editing.DeleteComponentInputSchema,
    editing.DeleteComponentOutputSchema,
    editing.DeleteComponentDescription,
  ),
  renameComponent: entry(
    "editing",
    editing.renameComponent,
    editing.RenameComponentInputSchema,
    editing.RenameComponentOutputSchema,
    editing.RenameComponentDescription,
  ),
  updateComponent: entry(
    "editing",
    editing.updateComponent,
    editing.UpdateComponentInputSchema,
    editing.UpdateComponentOutputSchema,
    editing.UpdateComponentDescription,
  ),
  addConnection: entry(
    "editing",
    editing.addConnection,
    editing.AddConnectionInputSchema,
    editing.AddConnectionOutputSchema,
    editing.AddConnectionDescription,
  ),
  deleteConnection: entry(
    "editing",
    editing.deleteConnection,
    editing.DeleteConnectionInputSchema,
    editing.DeleteConnectionOutputSchema,
    editing.DeleteConnectionDescription,
  ),
  updateConnection: entry(
    "editing",
    editing.updateConnection,
    editing.UpdateConnectionInputSchema,
    editing.UpdateConnectionOutputSchema,
    editing.UpdateConnectionDescription,
  ),
  updateConnectionNames: entry(
    "editing",
    editing.updateConnectionNames,
    editing.UpdateConnectionNamesInputSchema,
    editing.UpdateConnectionNamesOutputSchema,
    editing.UpdateConnectionNamesDescription,
  ),
  addTransition: entry(
    "editing",
    editing.addTransition,
    editing.AddTransitionInputSchema,
    editing.AddTransitionOutputSchema,
    editing.AddTransitionDescription,
  ),
  deleteTransition: entry(
    "editing",
    editing.deleteTransition,
    editing.DeleteTransitionInputSchema,
    editing.DeleteTransitionOutputSchema,
    editing.DeleteTransitionDescription,
  ),
  updateTransition: entry(
    "editing",
    editing.updateTransition,
    editing.UpdateTransitionInputSchema,
    editing.UpdateTransitionOutputSchema,
    editing.UpdateTransitionDescription,
  ),
  addClassAnnotation: entry(
    "editing",
    editing.addClassAnnotation,
    editing.AddClassAnnotationInputSchema,
    editing.AddClassAnnotationOutputSchema,
    editing.AddClassAnnotationDescription,
  ),
  setComponentProperties: entry(
    "editing",
    editing.setComponentProperties,
    editing.SetComponentPropertiesInputSchema,
    editing.SetComponentPropertiesOutputSchema,
    editing.SetComponentPropertiesDescription,
  ),
  setComponentDimensions: entry(
    "editing",
    editing.setComponentDimensions,
    editing.SetComponentDimensionsInputSchema,
    editing.SetComponentDimensionsOutputSchema,
    editing.SetComponentDimensionsDescription,
  ),
  setComponentComment: entry(
    "editing",
    editing.setComponentComment,
    editing.SetComponentCommentInputSchema,
    editing.SetComponentCommentOutputSchema,
    editing.SetComponentCommentDescription,
  ),
  setClassComment: entry(
    "editing",
    editing.setClassComment,
    editing.SetClassCommentInputSchema,
    editing.SetClassCommentOutputSchema,
    editing.SetClassCommentDescription,
  ),
  setDocumentationAnnotation: entry(
    "editing",
    editing.setDocumentationAnnotation,
    editing.SetDocumentationAnnotationInputSchema,
    editing.SetDocumentationAnnotationOutputSchema,
    editing.SetDocumentationAnnotationDescription,
  ),
  addInitialState: entry(
    "editing",
    editing.addInitialState,
    editing.AddInitialStateInputSchema,
    editing.AddInitialStateOutputSchema,
    editing.AddInitialStateDescription,
  ),
  deleteInitialState: entry(
    "editing",
    editing.deleteInitialState,
    editing.DeleteInitialStateInputSchema,
    editing.DeleteInitialStateOutputSchema,
    editing.DeleteInitialStateDescription,
  ),
  updateInitialState: entry(
    "editing",
    editing.updateInitialState,
    editing.UpdateInitialStateInputSchema,
    editing.UpdateInitialStateOutputSchema,
    editing.UpdateInitialStateDescription,
  ),
  renameComponentInClass: entry(
    "editing",
    editing.renameComponentInClass,
    editing.RenameComponentInClassInputSchema,
    editing.RenameComponentInClassOutputSchema,
    editing.RenameComponentInClassDescription,
  ),

  // --- Solver / runtime config ---
  setMatchingAlgorithm: entry(
    "solver",
    solver.setMatchingAlgorithm,
    solver.SetMatchingAlgorithmInputSchema,
    solver.SetMatchingAlgorithmOutputSchema,
    solver.SetMatchingAlgorithmDescription,
  ),
  setIndexReductionMethod: entry(
    "solver",
    solver.setIndexReductionMethod,
    solver.SetIndexReductionMethodInputSchema,
    solver.SetIndexReductionMethodOutputSchema,
    solver.SetIndexReductionMethodDescription,
  ),
  setCommandLineOptions: entry(
    "solver",
    solver.setCommandLineOptions,
    solver.SetCommandLineOptionsInputSchema,
    solver.SetCommandLineOptionsOutputSchema,
    solver.SetCommandLineOptionsDescription,
  ),
  getMatchingAlgorithm: entry(
    "solver",
    solver.getMatchingAlgorithm,
    solver.GetMatchingAlgorithmInputSchema,
    solver.GetMatchingAlgorithmOutputSchema,
    solver.GetMatchingAlgorithmDescription,
  ),
  getAvailableMatchingAlgorithms: entry(
    "solver",
    solver.getAvailableMatchingAlgorithms,
    solver.GetAvailableMatchingAlgorithmsInputSchema,
    solver.GetAvailableMatchingAlgorithmsOutputSchema,
    solver.GetAvailableMatchingAlgorithmsDescription,
  ),
  getIndexReductionMethod: entry(
    "solver",
    solver.getIndexReductionMethod,
    solver.GetIndexReductionMethodInputSchema,
    solver.GetIndexReductionMethodOutputSchema,
    solver.GetIndexReductionMethodDescription,
  ),
  getAvailableIndexReductionMethods: entry(
    "solver",
    solver.getAvailableIndexReductionMethods,
    solver.GetAvailableIndexReductionMethodsInputSchema,
    solver.GetAvailableIndexReductionMethodsOutputSchema,
    solver.GetAvailableIndexReductionMethodsDescription,
  ),
  getAvailableTearingMethods: entry(
    "solver",
    solver.getAvailableTearingMethods,
    solver.GetAvailableTearingMethodsInputSchema,
    solver.GetAvailableTearingMethodsOutputSchema,
    solver.GetAvailableTearingMethodsDescription,
  ),

  // --- Execution ---
  checkModel: entry(
    "execution",
    execution.checkModel,
    execution.CheckModelInputSchema,
    execution.CheckModelOutputSchema,
    execution.CheckModelDescription,
  ),
  translateModel: entry(
    "execution",
    execution.translateModel,
    execution.TranslateModelInputSchema,
    execution.TranslateModelOutputSchema,
    execution.TranslateModelDescription,
  ),
  buildModel: entry(
    "execution",
    execution.buildModel,
    execution.BuildModelInputSchema,
    execution.BuildModelOutputSchema,
    execution.BuildModelDescription,
  ),
  simulate: entry(
    "execution",
    execution.simulate,
    execution.SimulateInputSchema,
    execution.SimulateOutputSchema,
    execution.SimulateDescription,
  ),
  buildModelFMU: entry(
    "execution",
    execution.buildModelFMU,
    execution.BuildModelFMUInputSchema,
    execution.BuildModelFMUOutputSchema,
    execution.BuildModelFMUDescription,
  ),
  translateModelXML: entry(
    "execution",
    execution.translateModelXML,
    execution.TranslateModelXMLInputSchema,
    execution.TranslateModelXMLOutputSchema,
    execution.TranslateModelXMLDescription,
  ),
  importFMU: entry(
    "execution",
    execution.importFMU,
    execution.ImportFMUInputSchema,
    execution.ImportFMUOutputSchema,
    execution.ImportFMUDescription,
  ),
  getSimulationOptions: entry(
    "execution",
    execution.getSimulationOptions,
    execution.GetSimulationOptionsInputSchema,
    execution.GetSimulationOptionsOutputSchema,
    execution.GetSimulationOptionsDescription,
  ),
  isExperiment: entry(
    "execution",
    execution.isExperiment,
    execution.IsExperimentInputSchema,
    execution.IsExperimentOutputSchema,
    execution.IsExperimentDescription,
  ),

  // --- Results ---
  readSimulationResultSize: entry(
    "results",
    results.readSimulationResultSize,
    results.ReadSimulationResultSizeInputSchema,
    results.ReadSimulationResultSizeOutputSchema,
    results.ReadSimulationResultSizeDescription,
  ),
  readSimulationResultVars: entry(
    "results",
    results.readSimulationResultVars,
    results.ReadSimulationResultVarsInputSchema,
    results.ReadSimulationResultVarsOutputSchema,
    results.ReadSimulationResultVarsDescription,
  ),
  closeSimulationResultFile: entry(
    "results",
    results.closeSimulationResultFile,
    results.CloseSimulationResultFileInputSchema,
    results.CloseSimulationResultFileOutputSchema,
    results.CloseSimulationResultFileDescription,
  ),
  readSimulationResult: entry(
    "results",
    results.readSimulationResult,
    results.ReadSimulationResultInputSchema,
    results.ReadSimulationResultOutputSchema,
    results.ReadSimulationResultDescription,
  ),
  val: entry(
    "results",
    results.val,
    results.ValInputSchema,
    results.ValOutputSchema,
    results.ValDescription,
  ),
  filterSimulationResults: entry(
    "results",
    results.filterSimulationResults,
    results.FilterSimulationResultsInputSchema,
    results.FilterSimulationResultsOutputSchema,
    results.FilterSimulationResultsDescription,
  ),
  deltaSimulationResults: entry(
    "results",
    results.deltaSimulationResults,
    results.DeltaSimulationResultsInputSchema,
    results.DeltaSimulationResultsOutputSchema,
    results.DeltaSimulationResultsDescription,
  ),
  diffSimulationResults: entry(
    "results",
    results.diffSimulationResults,
    results.DiffSimulationResultsInputSchema,
    results.DiffSimulationResultsOutputSchema,
    results.DiffSimulationResultsDescription,
  ),
} as const;

/** Every OMC function name this package can dispatch to. */
export type OmcFnName = keyof typeof REGISTRY;

/** Input type for a given function name (parsed/output type, with defaults applied). */
export type OmcInput<K extends OmcFnName> = Parameters<
  (typeof REGISTRY)[K]["fn"]
>[1];

/** Output type for a given function name. */
export type OmcOutput<K extends OmcFnName> = Awaited<
  ReturnType<(typeof REGISTRY)[K]["fn"]>
>;

/** Sorted list of every OMC function name. Useful for CLIs and discovery. */
export const omcFunctionNames: readonly OmcFnName[] = (
  Object.keys(REGISTRY) as OmcFnName[]
).sort();

/** Map of category → function names within that category. */
export function functionsByCategory(): Record<string, OmcFnName[]> {
  const out: Record<string, OmcFnName[]> = {};
  for (const name of omcFunctionNames) {
    const cat = REGISTRY[name].category;
    (out[cat] ??= []).push(name);
  }
  return out;
}
