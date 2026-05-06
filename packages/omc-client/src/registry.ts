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
}

function entry<TInput, TOutput>(
  category: string,
  fn: (ctx: CallContext, input: TInput) => Promise<TOutput>,
  inputSchema: z.ZodType<unknown>,
  outputSchema: z.ZodType<TOutput>,
): RegistryEntry<TInput, TOutput> {
  return { fn, inputSchema, outputSchema, category };
}

export const REGISTRY = {
  // --- Browsing ---
  getVersion: entry("browsing", browsing.getVersion, browsing.GetVersionInputSchema, browsing.GetVersionOutputSchema),
  getClassNames: entry("browsing", browsing.getClassNames, browsing.GetClassNamesInputSchema, browsing.GetClassNamesOutputSchema),
  searchClassNames: entry("browsing", browsing.searchClassNames, browsing.SearchClassNamesInputSchema, browsing.SearchClassNamesOutputSchema),
  getClassInformation: entry("browsing", browsing.getClassInformation, browsing.GetClassInformationInputSchema, browsing.GetClassInformationOutputSchema),
  isPackage: entry("browsing", browsing.isPackage, browsing.IsPackageInputSchema, browsing.IsPackageOutputSchema),
  getInheritanceCount: entry("browsing", browsing.getInheritanceCount, browsing.GetInheritanceCountInputSchema, browsing.GetInheritanceCountOutputSchema),
  getInheritedClasses: entry("browsing", browsing.getInheritedClasses, browsing.GetInheritedClassesInputSchema, browsing.GetInheritedClassesOutputSchema),
  getUses: entry("browsing", browsing.getUses, browsing.GetUsesInputSchema, browsing.GetUsesOutputSchema),
  existClass: entry("browsing", browsing.existClass, browsing.ExistClassInputSchema, browsing.ExistClassOutputSchema),
  getErrorString: entry("browsing", browsing.getErrorString, browsing.GetErrorStringInputSchema, browsing.GetErrorStringOutputSchema),
  existModel: entry("browsing", browsing.existModel, browsing.ExistModelInputSchema, browsing.ExistModelOutputSchema),
  existPackage: entry("browsing", browsing.existPackage, browsing.ExistPackageInputSchema, browsing.ExistPackageOutputSchema),
  getClassRestriction: entry("browsing", browsing.getClassRestriction, browsing.GetClassRestrictionInputSchema, browsing.GetClassRestrictionOutputSchema),
  getClassComment: entry("browsing", browsing.getClassComment, browsing.GetClassCommentInputSchema, browsing.GetClassCommentOutputSchema),
  isType: entry("browsing", browsing.isType, browsing.IsTypeInputSchema, browsing.IsTypeOutputSchema),
  isClass: entry("browsing", browsing.isClass, browsing.IsClassInputSchema, browsing.IsClassOutputSchema),
  isRecord: entry("browsing", browsing.isRecord, browsing.IsRecordInputSchema, browsing.IsRecordOutputSchema),
  isBlock: entry("browsing", browsing.isBlock, browsing.IsBlockInputSchema, browsing.IsBlockOutputSchema),
  isFunction: entry("browsing", browsing.isFunction, browsing.IsFunctionInputSchema, browsing.IsFunctionOutputSchema),
  isModel: entry("browsing", browsing.isModel, browsing.IsModelInputSchema, browsing.IsModelOutputSchema),
  isConnector: entry("browsing", browsing.isConnector, browsing.IsConnectorInputSchema, browsing.IsConnectorOutputSchema),
  isPartial: entry("browsing", browsing.isPartial, browsing.IsPartialInputSchema, browsing.IsPartialOutputSchema),
  isReplaceable: entry("browsing", browsing.isReplaceable, browsing.IsReplaceableInputSchema, browsing.IsReplaceableOutputSchema),
  isProtectedClass: entry("browsing", browsing.isProtectedClass, browsing.IsProtectedClassInputSchema, browsing.IsProtectedClassOutputSchema),
  isEnumeration: entry("browsing", browsing.isEnumeration, browsing.IsEnumerationInputSchema, browsing.IsEnumerationOutputSchema),

  // --- Reading model contents ---
  getComponents: entry("contents", contents.getComponents, contents.GetComponentsInputSchema, contents.GetComponentsOutputSchema),
  getComponentAnnotations: entry("contents", contents.getComponentAnnotations, contents.GetComponentAnnotationsInputSchema, contents.GetComponentAnnotationsOutputSchema),
  getConnectionCount: entry("contents", contents.getConnectionCount, contents.GetConnectionCountInputSchema, contents.GetConnectionCountOutputSchema),
  getNthConnection: entry("contents", contents.getNthConnection, contents.GetNthConnectionInputSchema, contents.GetNthConnectionOutputSchema),
  getNthConnectionAnnotation: entry("contents", contents.getNthConnectionAnnotation, contents.GetNthConnectionAnnotationInputSchema, contents.GetNthConnectionAnnotationOutputSchema),
  getTransitions: entry("contents", contents.getTransitions, contents.GetTransitionsInputSchema, contents.GetTransitionsOutputSchema),
  getInitialStates: entry("contents", contents.getInitialStates, contents.GetInitialStatesInputSchema, contents.GetInitialStatesOutputSchema),
  getIconAnnotation: entry("contents", contents.getIconAnnotation, contents.GetIconAnnotationInputSchema, contents.GetIconAnnotationOutputSchema),
  getDiagramAnnotation: entry("contents", contents.getDiagramAnnotation, contents.GetDiagramAnnotationInputSchema, contents.GetDiagramAnnotationOutputSchema),
  getDocumentationAnnotation: entry("contents", contents.getDocumentationAnnotation, contents.GetDocumentationAnnotationInputSchema, contents.GetDocumentationAnnotationOutputSchema),
  listFile: entry("contents", contents.listFile, contents.ListFileInputSchema, contents.ListFileOutputSchema),
  instantiateModel: entry("contents", contents.instantiateModel, contents.InstantiateModelInputSchema, contents.InstantiateModelOutputSchema),
  getModelInstance: entry("contents", contents.getModelInstance, contents.GetModelInstanceInputSchema, contents.GetModelInstanceOutputSchema),
  getModelInstanceAnnotation: entry("contents", contents.getModelInstanceAnnotation, contents.GetModelInstanceAnnotationInputSchema, contents.GetModelInstanceAnnotationOutputSchema),
  modifierToJSON: entry("contents", contents.modifierToJSON, contents.ModifierToJSONInputSchema, contents.ModifierToJSONOutputSchema),
  getConnectionList: entry("contents", contents.getConnectionList, contents.GetConnectionListInputSchema, contents.GetConnectionListOutputSchema),
  getNthConnector: entry("contents", contents.getNthConnector, contents.GetNthConnectorInputSchema, contents.GetNthConnectorOutputSchema),
  getNthConnectorIconAnnotation: entry("contents", contents.getNthConnectorIconAnnotation, contents.GetNthConnectorIconAnnotationInputSchema, contents.GetNthConnectorIconAnnotationOutputSchema),
  getConnectorCount: entry("contents", contents.getConnectorCount, contents.GetConnectorCountInputSchema, contents.GetConnectorCountOutputSchema),
  getNthInheritedClassIconMapAnnotation: entry("contents", contents.getNthInheritedClassIconMapAnnotation, contents.GetNthInheritedClassIconMapAnnotationInputSchema, contents.GetNthInheritedClassIconMapAnnotationOutputSchema),
  getNthInheritedClassDiagramMapAnnotation: entry("contents", contents.getNthInheritedClassDiagramMapAnnotation, contents.GetNthInheritedClassDiagramMapAnnotationInputSchema, contents.GetNthInheritedClassDiagramMapAnnotationOutputSchema),
  getDefaultComponentName: entry("contents", contents.getDefaultComponentName, contents.GetDefaultComponentNameInputSchema, contents.GetDefaultComponentNameOutputSchema),
  getDefaultComponentPrefixes: entry("contents", contents.getDefaultComponentPrefixes, contents.GetDefaultComponentPrefixesInputSchema, contents.GetDefaultComponentPrefixesOutputSchema),
  getComponentComment: entry("contents", contents.getComponentComment, contents.GetComponentCommentInputSchema, contents.GetComponentCommentOutputSchema),

  // --- Lifecycle ---
  loadFile: entry("lifecycle", lifecycle.loadFile, lifecycle.LoadFileInputSchema, lifecycle.LoadFileOutputSchema),
  loadString: entry("lifecycle", lifecycle.loadString, lifecycle.LoadStringInputSchema, lifecycle.LoadStringOutputSchema),
  loadModel: entry("lifecycle", lifecycle.loadModel, lifecycle.LoadModelInputSchema, lifecycle.LoadModelOutputSchema),
  parseFile: entry("lifecycle", lifecycle.parseFile, lifecycle.ParseFileInputSchema, lifecycle.ParseFileOutputSchema),
  createClass: entry("lifecycle", lifecycle.createClass, lifecycle.CreateClassInputSchema, lifecycle.CreateClassOutputSchema),
  createSubClass: entry("lifecycle", lifecycle.createSubClass, lifecycle.CreateSubClassInputSchema, lifecycle.CreateSubClassOutputSchema),
  renameClass: entry("lifecycle", lifecycle.renameClass, lifecycle.RenameClassInputSchema, lifecycle.RenameClassOutputSchema),
  deleteClass: entry("lifecycle", lifecycle.deleteClass, lifecycle.DeleteClassInputSchema, lifecycle.DeleteClassOutputSchema),
  copyClass: entry("lifecycle", lifecycle.copyClass, lifecycle.CopyClassInputSchema, lifecycle.CopyClassOutputSchema),
  moveClass: entry("lifecycle", lifecycle.moveClass, lifecycle.MoveClassInputSchema, lifecycle.MoveClassOutputSchema),
  moveClassToTop: entry("lifecycle", lifecycle.moveClassToTop, lifecycle.MoveClassToTopInputSchema, lifecycle.MoveClassToTopOutputSchema),
  moveClassToBottom: entry("lifecycle", lifecycle.moveClassToBottom, lifecycle.MoveClassToBottomInputSchema, lifecycle.MoveClassToBottomOutputSchema),
  getSourceFile: entry("lifecycle", lifecycle.getSourceFile, lifecycle.GetSourceFileInputSchema, lifecycle.GetSourceFileOutputSchema),
  setSourceFile: entry("lifecycle", lifecycle.setSourceFile, lifecycle.SetSourceFileInputSchema, lifecycle.SetSourceFileOutputSchema),
  diffModelicaFileListings: entry("lifecycle", lifecycle.diffModelicaFileListings, lifecycle.DiffModelicaFileListingsInputSchema, lifecycle.DiffModelicaFileListingsOutputSchema),
  save: entry("lifecycle", lifecycle.save, lifecycle.SaveInputSchema, lifecycle.SaveOutputSchema),

  // --- Parameters & modifiers ---
  getParameterValue: entry("parameters", parameters.getParameterValue, parameters.GetParameterValueInputSchema, parameters.GetParameterValueOutputSchema),
  getComponentModifierNames: entry("parameters", parameters.getComponentModifierNames, parameters.GetComponentModifierNamesInputSchema, parameters.GetComponentModifierNamesOutputSchema),
  getComponentModifierValue: entry("parameters", parameters.getComponentModifierValue, parameters.GetComponentModifierValueInputSchema, parameters.GetComponentModifierValueOutputSchema),
  getComponentModifierValues: entry("parameters", parameters.getComponentModifierValues, parameters.GetComponentModifierValuesInputSchema, parameters.GetComponentModifierValuesOutputSchema),
  setComponentModifierValue: entry("parameters", parameters.setComponentModifierValue, parameters.SetComponentModifierValueInputSchema, parameters.SetComponentModifierValueOutputSchema),
  removeComponentModifiers: entry("parameters", parameters.removeComponentModifiers, parameters.RemoveComponentModifiersInputSchema, parameters.RemoveComponentModifiersOutputSchema),
  getExtendsModifierNames: entry("parameters", parameters.getExtendsModifierNames, parameters.GetExtendsModifierNamesInputSchema, parameters.GetExtendsModifierNamesOutputSchema),
  getExtendsModifierValue: entry("parameters", parameters.getExtendsModifierValue, parameters.GetExtendsModifierValueInputSchema, parameters.GetExtendsModifierValueOutputSchema),
  setExtendsModifierValue: entry("parameters", parameters.setExtendsModifierValue, parameters.SetExtendsModifierValueInputSchema, parameters.SetExtendsModifierValueOutputSchema),
  getParameterNames: entry("parameters", parameters.getParameterNames, parameters.GetParameterNamesInputSchema, parameters.GetParameterNamesOutputSchema),
  setParameterValue: entry("parameters", parameters.setParameterValue, parameters.SetParameterValueInputSchema, parameters.SetParameterValueOutputSchema),

  // --- Elements (modern Component* generalization) ---
  getElements: entry("elements", elements.getElements, elements.GetElementsInputSchema, elements.GetElementsOutputSchema),
  getElementsInfo: entry("elements", elements.getElementsInfo, elements.GetElementsInfoInputSchema, elements.GetElementsInfoOutputSchema),
  getElementAnnotation: entry("elements", elements.getElementAnnotation, elements.GetElementAnnotationInputSchema, elements.GetElementAnnotationOutputSchema),
  getElementAnnotations: entry("elements", elements.getElementAnnotations, elements.GetElementAnnotationsInputSchema, elements.GetElementAnnotationsOutputSchema),
  getElementModifierNames: entry("elements", elements.getElementModifierNames, elements.GetElementModifierNamesInputSchema, elements.GetElementModifierNamesOutputSchema),
  getElementModifierValue: entry("elements", elements.getElementModifierValue, elements.GetElementModifierValueInputSchema, elements.GetElementModifierValueOutputSchema),
  getElementModifierValues: entry("elements", elements.getElementModifierValues, elements.GetElementModifierValuesInputSchema, elements.GetElementModifierValuesOutputSchema),
  setElementModifierValue: entry("elements", elements.setElementModifierValue, elements.SetElementModifierValueInputSchema, elements.SetElementModifierValueOutputSchema),
  setElementAnnotation: entry("elements", elements.setElementAnnotation, elements.SetElementAnnotationInputSchema, elements.SetElementAnnotationOutputSchema),
  setElementType: entry("elements", elements.setElementType, elements.SetElementTypeInputSchema, elements.SetElementTypeOutputSchema),
  removeElementModifiers: entry("elements", elements.removeElementModifiers, elements.RemoveElementModifiersInputSchema, elements.RemoveElementModifiersOutputSchema),

  // --- Library / package management ---
  getAvailableLibraries: entry("library", library.getAvailableLibraries, library.GetAvailableLibrariesInputSchema, library.GetAvailableLibrariesOutputSchema),
  getAvailableLibraryVersions: entry("library", library.getAvailableLibraryVersions, library.GetAvailableLibraryVersionsInputSchema, library.GetAvailableLibraryVersionsOutputSchema),
  getAvailablePackageVersions: entry("library", library.getAvailablePackageVersions, library.GetAvailablePackageVersionsInputSchema, library.GetAvailablePackageVersionsOutputSchema),
  installPackage: entry("library", library.installPackage, library.InstallPackageInputSchema, library.InstallPackageOutputSchema),
  updatePackageIndex: entry("library", library.updatePackageIndex, library.UpdatePackageIndexInputSchema, library.UpdatePackageIndexOutputSchema),
  upgradeInstalledPackages: entry("library", library.upgradeInstalledPackages, library.UpgradeInstalledPackagesInputSchema, library.UpgradeInstalledPackagesOutputSchema),
  getLoadedLibraries: entry("library", library.getLoadedLibraries, library.GetLoadedLibrariesInputSchema, library.GetLoadedLibrariesOutputSchema),
  getPackages: entry("library", library.getPackages, library.GetPackagesInputSchema, library.GetPackagesOutputSchema),
  loadFiles: entry("library", library.loadFiles, library.LoadFilesInputSchema, library.LoadFilesOutputSchema),

  // --- Editing ---
  addComponent: entry("editing", editing.addComponent, editing.AddComponentInputSchema, editing.AddComponentOutputSchema),
  deleteComponent: entry("editing", editing.deleteComponent, editing.DeleteComponentInputSchema, editing.DeleteComponentOutputSchema),
  renameComponent: entry("editing", editing.renameComponent, editing.RenameComponentInputSchema, editing.RenameComponentOutputSchema),
  updateComponent: entry("editing", editing.updateComponent, editing.UpdateComponentInputSchema, editing.UpdateComponentOutputSchema),
  addConnection: entry("editing", editing.addConnection, editing.AddConnectionInputSchema, editing.AddConnectionOutputSchema),
  deleteConnection: entry("editing", editing.deleteConnection, editing.DeleteConnectionInputSchema, editing.DeleteConnectionOutputSchema),
  updateConnection: entry("editing", editing.updateConnection, editing.UpdateConnectionInputSchema, editing.UpdateConnectionOutputSchema),
  addTransition: entry("editing", editing.addTransition, editing.AddTransitionInputSchema, editing.AddTransitionOutputSchema),
  deleteTransition: entry("editing", editing.deleteTransition, editing.DeleteTransitionInputSchema, editing.DeleteTransitionOutputSchema),
  addClassAnnotation: entry("editing", editing.addClassAnnotation, editing.AddClassAnnotationInputSchema, editing.AddClassAnnotationOutputSchema),
  setComponentProperties: entry("editing", editing.setComponentProperties, editing.SetComponentPropertiesInputSchema, editing.SetComponentPropertiesOutputSchema),
  setComponentDimensions: entry("editing", editing.setComponentDimensions, editing.SetComponentDimensionsInputSchema, editing.SetComponentDimensionsOutputSchema),
  setComponentComment: entry("editing", editing.setComponentComment, editing.SetComponentCommentInputSchema, editing.SetComponentCommentOutputSchema),
  setClassComment: entry("editing", editing.setClassComment, editing.SetClassCommentInputSchema, editing.SetClassCommentOutputSchema),
  setDocumentationAnnotation: entry("editing", editing.setDocumentationAnnotation, editing.SetDocumentationAnnotationInputSchema, editing.SetDocumentationAnnotationOutputSchema),

  // --- Solver / runtime config ---
  getSolverMethods: entry("solver", solver.getSolverMethods, solver.GetSolverMethodsInputSchema, solver.GetSolverMethodsOutputSchema),
  getJacobianMethods: entry("solver", solver.getJacobianMethods, solver.GetJacobianMethodsInputSchema, solver.GetJacobianMethodsOutputSchema),
  getInitializationMethods: entry("solver", solver.getInitializationMethods, solver.GetInitializationMethodsInputSchema, solver.GetInitializationMethodsOutputSchema),
  getLinearSolvers: entry("solver", solver.getLinearSolvers, solver.GetLinearSolversInputSchema, solver.GetLinearSolversOutputSchema),
  getNonLinearSolvers: entry("solver", solver.getNonLinearSolvers, solver.GetNonLinearSolversInputSchema, solver.GetNonLinearSolversOutputSchema),
  setMatchingAlgorithm: entry("solver", solver.setMatchingAlgorithm, solver.SetMatchingAlgorithmInputSchema, solver.SetMatchingAlgorithmOutputSchema),
  setIndexReductionMethod: entry("solver", solver.setIndexReductionMethod, solver.SetIndexReductionMethodInputSchema, solver.SetIndexReductionMethodOutputSchema),
  setCommandLineOptions: entry("solver", solver.setCommandLineOptions, solver.SetCommandLineOptionsInputSchema, solver.SetCommandLineOptionsOutputSchema),

  // --- Execution ---
  checkModel: entry("execution", execution.checkModel, execution.CheckModelInputSchema, execution.CheckModelOutputSchema),
  translateModel: entry("execution", execution.translateModel, execution.TranslateModelInputSchema, execution.TranslateModelOutputSchema),
  buildModel: entry("execution", execution.buildModel, execution.BuildModelInputSchema, execution.BuildModelOutputSchema),
  simulate: entry("execution", execution.simulate, execution.SimulateInputSchema, execution.SimulateOutputSchema),
  buildModelFMU: entry("execution", execution.buildModelFMU, execution.BuildModelFMUInputSchema, execution.BuildModelFMUOutputSchema),
  translateModelXML: entry("execution", execution.translateModelXML, execution.TranslateModelXMLInputSchema, execution.TranslateModelXMLOutputSchema),
  importFMU: entry("execution", execution.importFMU, execution.ImportFMUInputSchema, execution.ImportFMUOutputSchema),
  getSimulationOptions: entry("execution", execution.getSimulationOptions, execution.GetSimulationOptionsInputSchema, execution.GetSimulationOptionsOutputSchema),
  isExperiment: entry("execution", execution.isExperiment, execution.IsExperimentInputSchema, execution.IsExperimentOutputSchema),

  // --- Results ---
  readSimulationResultSize: entry("results", results.readSimulationResultSize, results.ReadSimulationResultSizeInputSchema, results.ReadSimulationResultSizeOutputSchema),
  readSimulationResultVars: entry("results", results.readSimulationResultVars, results.ReadSimulationResultVarsInputSchema, results.ReadSimulationResultVarsOutputSchema),
  closeSimulationResultFile: entry("results", results.closeSimulationResultFile, results.CloseSimulationResultFileInputSchema, results.CloseSimulationResultFileOutputSchema),
  readSimulationResult: entry("results", results.readSimulationResult, results.ReadSimulationResultInputSchema, results.ReadSimulationResultOutputSchema),
  val: entry("results", results.val, results.ValInputSchema, results.ValOutputSchema),
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
