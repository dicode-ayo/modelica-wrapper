/**
 * Classifies an outgoing OMC command string as a mutation and names what it
 * touched.
 *
 * OMC cannot announce a change on its own — the ZeroMQ channel is REQ/REP, one
 * send one receive, with no back-channel — so every surface derived from a
 * class goes stale silently when the REPL, the exported API, or any other
 * caller mutates it. `OmcClient.call()` is the one point every command passes
 * through, typed wrapper and raw REPL text alike, which is where the
 * announcement is derived from.
 *
 * The table is exhaustive over `OmcFunction`: a name added to that union fails
 * the build until it is classified here, so a new mutating wrapper cannot
 * arrive silent.
 *
 * Every uncertainty resolves to a coarse announcement, never to silence — an
 * unparseable command, a name the table does not know, an argument that is
 * missing or is not a name. A coarse announcement about a call that changed
 * nothing costs one wasted re-read; silence about one that changed something
 * is the staleness this exists to prevent.
 */

import type { OmcFunction } from "./commands.js";
import { asString, parseLeading } from "./parse.js";

/** What a mutation touched, as far as the command string can tell. */
export type MutationScope =
  | { readonly kind: "class"; readonly className: string }
  | { readonly kind: "file"; readonly fileName: string }
  | { readonly kind: "coarse" };

export interface OmcMutation {
  /**
   * The OMC function that mutated. `undefined` when the command did not parse
   * as a call, or named something outside {@link OmcFunction} — a REPL typo,
   * an assignment, a scripting construct we don't wrap.
   */
  readonly fn: OmcFunction | undefined;
  readonly scope: MutationScope;
}

/**
 * How one OMC function announces itself:
 *
 * - `"readOnly"` — changes nothing any cache derives from a class.
 * - `"coarse"` — mutates, but the affected class is not readable from a single
 *   argument. `renameClass`'s second argument is a bare leaf, `copyClass`
 *   composes parent and leaf, `moveClassToTop` reorders a parent that appears
 *   nowhere in the call. Reading those as class names gives a confidently
 *   wrong answer, which is worse than no answer, and they are rare enough that
 *   one extra refresh is cheap.
 * - `{ pos, as }` — argument `pos` holds the affected class name or file path.
 *
 * Data rather than a function per entry, so the table is auditable by reading
 * it.
 */
type MutationEntry =
  | "readOnly"
  | "coarse"
  | { readonly pos: number; readonly as: "class" | "file" };

/**
 * Argument positions follow OMC's own signatures, which disagree with
 * themselves: `addConnection`/`deleteConnection` carry the class third,
 * `updateConnection` first; `addComponent` third, `deleteComponent` second.
 *
 * `loadString` and `loadFile` are file-scoped rather than coarse because both
 * the editor's save path and the diagram's reverse sync go through
 * `loadString`. Coarse there would refresh every open Modelica editor on every
 * save.
 */
const MUTATIONS: Record<OmcFunction, MutationEntry> = {
  // --- Lifecycle / transport ---
  quit: "readOnly",
  getErrorString: "readOnly",
  getMessagesStringInternal: "readOnly",
  getVersion: "readOnly",

  // --- Browsing ---
  getModelicaPath: "readOnly",
  getClassNames: "readOnly",
  searchClassNames: "readOnly",
  getClassInformation: "readOnly",
  isPackage: "readOnly",
  getInheritanceCount: "readOnly",
  getInheritedClasses: "readOnly",
  getUses: "readOnly",
  existClass: "readOnly",
  existModel: "readOnly",
  existPackage: "readOnly",
  getClassRestriction: "readOnly",
  getClassComment: "readOnly",
  isType: "readOnly",
  isClass: "readOnly",
  isRecord: "readOnly",
  isBlock: "readOnly",
  isFunction: "readOnly",
  isModel: "readOnly",
  isConnector: "readOnly",
  isPartial: "readOnly",
  isReplaceable: "readOnly",
  isProtectedClass: "readOnly",
  isEnumeration: "readOnly",
  isConstant: "readOnly",
  isParameter: "readOnly",
  isProtected: "readOnly",
  isRedeclare: "readOnly",
  isPrimitive: "readOnly",
  isOperator: "readOnly",
  isOperatorFunction: "readOnly",
  isOperatorRecord: "readOnly",
  isOptimization: "readOnly",
  getEnumerationLiterals: "readOnly",
  getReplaceableChoices: "readOnly",
  extendsFrom: "readOnly",
  getAllSubtypeOf: "readOnly",
  classAnnotationExists: "readOnly",
  getNthInheritedClass: "readOnly",
  isShortDefinition: "readOnly",

  // --- Reading model contents ---
  getComponents: "readOnly",
  getComponentAnnotations: "readOnly",
  getConnectionCount: "readOnly",
  getNthConnection: "readOnly",
  getNthConnectionAnnotation: "readOnly",
  getTransitions: "readOnly",
  getInitialStates: "readOnly",
  getIconAnnotation: "readOnly",
  getDiagramAnnotation: "readOnly",
  getDocumentationAnnotation: "readOnly",
  listFile: "readOnly",
  instantiateModel: "readOnly",
  getModelInstance: "readOnly",
  getModelInstanceAnnotation: "readOnly",
  modifierToJSON: "readOnly",
  getConnectionList: "readOnly",
  getNthConnector: "readOnly",
  getNthConnectorIconAnnotation: "readOnly",
  getConnectorCount: "readOnly",
  getNthInheritedClassIconMapAnnotation: "readOnly",
  getNthInheritedClassDiagramMapAnnotation: "readOnly",
  getDefaultComponentName: "readOnly",
  getDefaultComponentPrefixes: "readOnly",
  getComponentComment: "readOnly",
  getInstantiatedParametersAndValues: "readOnly",
  getAnnotationNamedModifiers: "readOnly",
  getAnnotationModifierValue: "readOnly",
  getComponentCount: "readOnly",
  getNthComponent: "readOnly",
  getNthComponentAnnotation: "readOnly",
  getNthComponentCondition: "readOnly",
  getNthComponentModification: "readOnly",
  getAnnotationCount: "readOnly",
  getNthAnnotationString: "readOnly",
  getAlgorithmCount: "readOnly",
  getNthAlgorithm: "readOnly",
  getAlgorithmItemsCount: "readOnly",
  getNthAlgorithmItem: "readOnly",
  getInitialAlgorithmCount: "readOnly",
  getNthInitialAlgorithm: "readOnly",
  getInitialAlgorithmItemsCount: "readOnly",
  getNthInitialAlgorithmItem: "readOnly",
  getNthEquation: "readOnly",
  getNthEquationItem: "readOnly",
  getInitialEquationCount: "readOnly",
  getNthInitialEquation: "readOnly",
  getInitialEquationItemsCount: "readOnly",
  getNthInitialEquationItem: "readOnly",
  getImportCount: "readOnly",
  getNthImport: "readOnly",
  convertUnits: "readOnly",
  getDerivedUnits: "readOnly",
  uriToFilename: "readOnly",
  qualifyPath: "readOnly",

  // --- Source / lifecycle ---
  loadFile: { pos: 0, as: "file" },
  loadString: { pos: 1, as: "file" },
  loadModel: "coarse",
  parseFile: "readOnly",
  parseString: "readOnly",
  newModel: { pos: 0, as: "class" },
  renameClass: "coarse",
  deleteClass: { pos: 0, as: "class" },
  copyClass: "coarse",
  moveClass: "coarse",
  moveClassToTop: "coarse",
  moveClassToBottom: "coarse",
  getSourceFile: "readOnly",
  setSourceFile: { pos: 0, as: "class" },
  diffModelicaFileListings: "readOnly",
  save: "readOnly",
  cd: "readOnly",
  loadClassContentString: { pos: 1, as: "class" },

  // --- Parameters & modifiers ---
  getParameterValue: "readOnly",
  getParameterNames: "readOnly",
  setParameterValue: { pos: 0, as: "class" },
  getComponentModifierNames: "readOnly",
  getComponentModifierValue: "readOnly",
  getComponentModifierValues: "readOnly",
  setComponentModifierValue: { pos: 0, as: "class" },
  removeComponentModifiers: { pos: 0, as: "class" },
  getExtendsModifierNames: "readOnly",
  getExtendsModifierValue: "readOnly",
  setExtendsModifierValue: { pos: 0, as: "class" },
  removeExtendsModifiers: { pos: 0, as: "class" },
  getDerivedClassModifierNames: "readOnly",
  getDerivedClassModifierValue: "readOnly",
  isExtendsModifierFinal: "readOnly",
  setExtendsModifier: { pos: 0, as: "class" },

  // --- Elements (modern Component* generalization) ---
  getElements: "readOnly",
  getElementsInfo: "readOnly",
  getElementAnnotation: "readOnly",
  getElementAnnotations: "readOnly",
  getElementModifierNames: "readOnly",
  getElementModifierValue: "readOnly",
  getElementModifierValues: "readOnly",
  setElementModifierValue: { pos: 0, as: "class" },
  setElementAnnotation: { pos: 0, as: "class" },
  setElementType: { pos: 0, as: "class" },
  removeElementModifiers: { pos: 0, as: "class" },

  // --- Library / package management ---
  getAvailableLibraries: "readOnly",
  getAvailableLibraryVersions: "readOnly",
  getAvailablePackageVersions: "readOnly",
  getAvailablePackageConversionsFrom: "readOnly",
  getAvailablePackageConversionsTo: "readOnly",
  getConversionsFromVersions: "readOnly",
  installPackage: "coarse",
  updatePackageIndex: "readOnly",
  upgradeInstalledPackages: "coarse",
  getLoadedLibraries: "readOnly",
  getPackages: "readOnly",
  loadFiles: "coarse",

  // --- Editing ---
  addComponent: { pos: 2, as: "class" },
  deleteComponent: { pos: 1, as: "class" },
  renameComponent: { pos: 0, as: "class" },
  updateComponent: { pos: 2, as: "class" },
  addConnection: { pos: 2, as: "class" },
  deleteConnection: { pos: 2, as: "class" },
  updateConnection: { pos: 0, as: "class" },
  updateConnectionNames: { pos: 0, as: "class" },
  addTransition: { pos: 0, as: "class" },
  deleteTransition: { pos: 0, as: "class" },
  updateTransition: { pos: 0, as: "class" },
  addClassAnnotation: { pos: 0, as: "class" },
  setComponentProperties: { pos: 0, as: "class" },
  setComponentDimensions: { pos: 0, as: "class" },
  setComponentComment: { pos: 0, as: "class" },
  setClassComment: { pos: 0, as: "class" },
  setDocumentationAnnotation: { pos: 0, as: "class" },
  addInitialState: { pos: 0, as: "class" },
  deleteInitialState: { pos: 0, as: "class" },
  updateInitialState: { pos: 0, as: "class" },
  renameComponentInClass: { pos: 0, as: "class" },

  // --- Solver / runtime config ---
  setMatchingAlgorithm: "readOnly",
  setIndexReductionMethod: "readOnly",
  setCommandLineOptions: "readOnly",
  getMatchingAlgorithm: "readOnly",
  getAvailableMatchingAlgorithms: "readOnly",
  getIndexReductionMethod: "readOnly",
  getAvailableIndexReductionMethods: "readOnly",
  getAvailableTearingMethods: "readOnly",

  // --- Execution ---
  checkModel: "readOnly",
  translateModel: "readOnly",
  buildModel: "readOnly",
  simulate: "readOnly",
  buildModelFMU: "readOnly",
  translateModelXML: "readOnly",
  importFMU: "coarse",
  getSimulationOptions: "readOnly",
  isExperiment: "readOnly",

  // --- Results ---
  readSimulationResultSize: "readOnly",
  readSimulationResultVars: "readOnly",
  closeSimulationResultFile: "readOnly",
  readSimulationResult: "readOnly",
  val: "readOnly",
  filterSimulationResults: "readOnly",
  deltaSimulationResults: "readOnly",
  diffSimulationResults: "readOnly",
};

/** Narrows a parsed command name to a function the table classifies. */
function isOmcFunction(name: string): name is OmcFunction {
  return Object.hasOwn(MUTATIONS, name);
}

const COARSE = (fn: OmcFunction | undefined): OmcMutation => ({
  fn,
  scope: { kind: "coarse" },
});

/**
 * The mutation `cmd` announces, or `undefined` when it announces nothing.
 *
 * `parseLeading` reads the command the same way it reads a response: dotted
 * names arrive whole, quoted identifiers survive, a `$Code(...)` argument is a
 * nested call, and a trailing `;` lands in the trailing text. What defeats it
 * — `x := simulate(M)`, where the leading value is a bare identifier — comes
 * back coarse.
 */
export function mutationFor(cmd: string): OmcMutation | undefined {
  let head;
  try {
    head = parseLeading(cmd).value;
  } catch {
    return COARSE(undefined);
  }
  if (head.kind !== "call" || !isOmcFunction(head.name)) {
    return COARSE(undefined);
  }

  const entry = MUTATIONS[head.name];
  if (entry === "readOnly") return undefined;
  if (entry === "coarse") return COARSE(head.name);

  const arg = head.args[entry.pos];
  const name = arg === undefined ? undefined : asString(arg);
  if (name === undefined || name === "") return COARSE(head.name);

  return {
    fn: head.name,
    scope:
      entry.as === "class"
        ? { kind: "class", className: name }
        : { kind: "file", fileName: name },
  };
}
