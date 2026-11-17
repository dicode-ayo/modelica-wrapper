/**
 * Whitelist of OMC interactive-API function names that this client knows how
 * to invoke. Used to constrain the `cmd` argument of `OmcTransport.send` and
 * `OmcClient.call` so typos are caught at compile time.
 *
 * Grouped by the README's categories. To add a new wrapper:
 *   1. Add the bare function name to the union below.
 *   2. Add a typed method on OmcClient that builds the command string.
 *
 * The corresponding OMC documentation lives at:
 *   https://build.openmodelica.org/Documentation/OpenModelica.Scripting.html
 */

export type OmcFunction =
  // --- Lifecycle / transport ---
  | "quit"
  | "getErrorString"
  | "getMessagesStringInternal"
  | "getVersion"

  // --- Browsing ---
  | "getModelicaPath"
  | "setModelicaPath"
  | "getInstallationDirectoryPath"
  | "setInstallationDirectoryPath"
  | "getTempDirectoryPath"
  | "setTempDirectoryPath"
  | "getLanguageStandard"
  | "setLanguageStandard"
  | "getEnvironmentVar"
  | "setEnvironmentVar"
  | "getClassNames"
  | "searchClassNames"
  | "getClassInformation"
  | "isPackage"
  | "getInheritanceCount"
  | "getInheritedClasses"
  | "getUses"
  | "existClass"
  | "existModel"
  | "existPackage"
  | "getClassRestriction"
  | "getClassComment"
  | "isType"
  | "isClass"
  | "isRecord"
  | "isBlock"
  | "isFunction"
  | "isModel"
  | "isConnector"
  | "isPartial"
  | "isReplaceable"
  | "isProtectedClass"
  | "isEnumeration"
  | "isConstant"
  | "isParameter"
  | "isProtected"
  | "isRedeclare"
  | "isPrimitive"
  | "isOperator"
  | "isOperatorFunction"
  | "isOperatorRecord"
  | "isOptimization"
  | "getEnumerationLiterals"
  | "getReplaceableChoices"
  | "extendsFrom"
  | "getAllSubtypeOf"
  | "classAnnotationExists"
  | "getNthInheritedClass"
  | "isShortDefinition"

  // --- Reading model contents ---
  | "getComponents"
  | "getComponentAnnotations"
  | "getConnectionCount"
  | "getNthConnection"
  | "getNthConnectionAnnotation"
  | "getTransitions"
  | "getInitialStates"
  | "getIconAnnotation"
  | "getDiagramAnnotation"
  | "getDocumentationAnnotation"
  | "listFile"
  | "instantiateModel"
  | "getModelInstance"
  | "getModelInstanceAnnotation"
  | "modifierToJSON"
  | "getConnectionList"
  | "getNthConnector"
  | "getNthConnectorIconAnnotation"
  | "getConnectorCount"
  | "getNthInheritedClassIconMapAnnotation"
  | "getNthInheritedClassDiagramMapAnnotation"
  | "getDefaultComponentName"
  | "getDefaultComponentPrefixes"
  | "getComponentComment"
  | "getInstantiatedParametersAndValues"
  | "getAnnotationNamedModifiers"
  | "getAnnotationModifierValue"
  | "getComponentCount"
  | "getNthComponent"
  | "getNthComponentAnnotation"
  | "getNthComponentCondition"
  | "getNthComponentModification"
  | "getAnnotationCount"
  | "getNthAnnotationString"
  | "getAlgorithmCount"
  | "getNthAlgorithm"
  | "getAlgorithmItemsCount"
  | "getNthAlgorithmItem"
  | "getInitialAlgorithmCount"
  | "getNthInitialAlgorithm"
  | "getInitialAlgorithmItemsCount"
  | "getNthInitialAlgorithmItem"
  | "getNthEquation"
  | "getNthEquationItem"
  | "getInitialEquationCount"
  | "getNthInitialEquation"
  | "getInitialEquationItemsCount"
  | "getNthInitialEquationItem"
  | "getImportCount"
  | "getNthImport"
  | "convertUnits"
  | "getDerivedUnits"
  | "uriToFilename"
  | "qualifyPath"

  // --- Source / lifecycle ---
  | "loadFile"
  | "loadString"
  | "loadModel"
  | "parseFile"
  | "parseString"
  | "newModel"
  | "renameClass"
  | "deleteClass"
  | "copyClass"
  | "moveClass"
  | "moveClassToTop"
  | "moveClassToBottom"
  | "getSourceFile"
  | "setSourceFile"
  | "diffModelicaFileListings"
  | "save"
  | "cd"
  | "loadClassContentString"

  // --- Parameters & modifiers ---
  | "getParameterValue"
  // Names a wrapper, not an OMC function: see ConstantReference.
  | "evaluateConstant"
  | "getParameterNames"
  | "setParameterValue"
  | "getComponentModifierNames"
  | "getComponentModifierValue"
  | "getComponentModifierValues"
  | "setComponentModifierValue"
  | "removeComponentModifiers"
  | "getExtendsModifierNames"
  | "getExtendsModifierValue"
  | "setExtendsModifierValue"
  | "removeExtendsModifiers"
  | "getDerivedClassModifierNames"
  | "getDerivedClassModifierValue"
  | "isExtendsModifierFinal"
  | "setExtendsModifier"

  // --- Elements (modern Component* generalization) ---
  | "getElements"
  | "getElementsInfo"
  | "getElementAnnotation"
  | "getElementAnnotations"
  | "getElementModifierNames"
  | "getElementModifierValue"
  | "getElementModifierValues"
  | "setElementModifierValue"
  | "setElementAnnotation"
  | "setElementType"
  | "removeElementModifiers"

  // --- Library / package management ---
  | "getAvailableLibraries"
  | "getAvailableLibraryVersions"
  | "getAvailablePackageVersions"
  | "getAvailablePackageConversionsFrom"
  | "getAvailablePackageConversionsTo"
  | "getConversionsFromVersions"
  | "installPackage"
  | "updatePackageIndex"
  | "upgradeInstalledPackages"
  | "getLoadedLibraries"
  | "getPackages"
  | "loadFiles"

  // --- Editing ---
  | "addComponent"
  | "deleteComponent"
  | "renameComponent"
  | "updateComponent"
  | "addConnection"
  | "deleteConnection"
  | "updateConnection"
  | "updateConnectionNames"
  | "addTransition"
  | "deleteTransition"
  | "updateTransition"
  | "addClassAnnotation"
  | "setComponentProperties"
  | "setComponentDimensions"
  | "setComponentComment"
  | "setClassComment"
  | "setDocumentationAnnotation"
  | "addInitialState"
  | "deleteInitialState"
  | "updateInitialState"
  | "renameComponentInClass"

  // --- Solver / runtime config ---
  | "setMatchingAlgorithm"
  | "setIndexReductionMethod"
  | "setCommandLineOptions"
  | "getMatchingAlgorithm"
  | "getAvailableMatchingAlgorithms"
  | "getIndexReductionMethod"
  | "getAvailableIndexReductionMethods"
  | "getAvailableTearingMethods"

  // --- Execution ---
  | "checkModel"
  | "translateModel"
  | "buildModel"
  | "simulate"
  | "buildModelFMU"
  | "translateModelXML"
  | "importFMU"
  | "getSimulationOptions"
  | "isExperiment"

  // --- Results ---
  | "readSimulationResultSize"
  | "readSimulationResultVars"
  | "closeSimulationResultFile"
  | "readSimulationResult"
  | "val"
  | "filterSimulationResults"
  | "deltaSimulationResults"
  | "diffSimulationResults";

/**
 * A well-formed OMC RPC command string: a known function name followed by
 * a parenthesised argument list. Argument *contents* are not type-checked
 * (they're runtime data — class names, file paths, raw Modelica expressions);
 * only the function-name prefix is enforced.
 *
 * Examples:
 *   "getVersion()"                                       ✓
 *   "getClassInformation(Modelica.Blocks.Math.Sin)"      ✓
 *   "loadFile(\"/path/file.mo\", \"\", uses=true, ...)"   ✓
 *   "bogusName()"                                        ✗ (not in OmcFunction)
 *   "Modelica.Constants.eps"                             ✓ (a ConstantReference)
 *   "evaluateConstant(Modelica.Constants.eps)"           ✗ (names a wrapper)
 */
export type OmcCommand =
  `${Exclude<OmcFunction, "evaluateConstant">}(${string})` | ConstantReference;

/**
 * Fully qualified, unsubscripted dotted name — at least two plain identifier
 * segments, no Q-IDENT. The same guard OMEdit's `OMCProxy::evaluateConstant`
 * applies before handing a name to OMC's interactive evaluator.
 */
export const CONSTANT_REFERENCE =
  /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/;

declare const constantReferenceBrand: unique symbol;

/**
 * A bare constant reference (`Modelica.Constants.eps`) sent as the whole
 * command, which OMC's interactive evaluator reduces to the constant's value.
 * It is the one command that is not a call: the `evaluateConstant` entry in
 * {@link OmcFunction} names the wrapper that sends it, not an OMC function.
 * Branded so only {@link constantReference}'s guard can produce one.
 */
export type ConstantReference = string & {
  readonly [constantReferenceBrand]: true;
};

/** `name` as a {@link ConstantReference}, or `undefined` when it fails the guard. */
export function constantReference(name: string): ConstantReference | undefined {
  return CONSTANT_REFERENCE.test(name)
    ? (name as ConstantReference)
    : undefined;
}
