/**
 * OmcClient — typed, schema-validated client for OpenModelica's interactive
 * ZeroMQ scripting API.
 *
 * - Single OMC subprocess + REQ socket per instance
 * - All calls serialize through a promise-chain mutex (OMC is single-threaded)
 * - Each method delegates to a per-function module in `./api/<category>/<fn>.ts`
 *   that owns its Zod input/output schemas
 *
 * Functional API consumers can also call those modules directly with a
 * `CallContext` they construct themselves.
 */

import type { CallContext } from "./_shared/callContext.js";
import type { OmcCommand } from "./commands.js";
import { spawnOmc, type OmcProcess } from "./process.js";
import { OmcTransport } from "./transport.js";
import { expectBool, parse } from "./parse.js";

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
import {
  REGISTRY,
  type OmcFnName,
  type OmcInput,
  type OmcOutput,
} from "./registry.js";
import {
  SUPPORTED_OMC,
  compatibilityReport,
  type CompatibilityReport,
} from "./version.js";

const DEFAULT_CALL_TIMEOUT_MS = 60_000;

export interface OmcClientOptions {
  /** Path to omc binary. Empty/undefined uses "omc" from PATH. */
  omcPath?: string;
  /** Per-call timeout in ms (default 60_000). Pass 0 to disable. */
  callTimeoutMs?: number;
}

export class OmcClient implements CallContext {
  private constructor(
    private readonly proc: OmcProcess,
    private readonly transport: OmcTransport,
    private callTimeoutMs: number,
  ) {}

  /** Promise-chain mutex: every call awaits the previous before issuing. */
  private chain: Promise<unknown> = Promise.resolve();
  private closed = false;
  /**
   * Raw OMC command string from the most recent `call()` invocation, or
   * `null` if none has happened yet. Captured eagerly (before the
   * transport send) so it's still readable when the call throws or
   * times out — which is exactly when consumers most want to know what
   * we asked for. Read-only outside the class.
   */
  private _lastCall: string | null = null;
  get lastCall(): string | null {
    return this._lastCall;
  }

  /** Spawn OMC, dial its ZMQ endpoint, and return a connected client. */
  static async create(opts: OmcClientOptions = {}): Promise<OmcClient> {
    const proc = await spawnOmc(opts.omcPath ?? "");
    const transport = new OmcTransport(proc.endpoint);
    try {
      await transport.dial();
    } catch (err) {
      await proc.stop();
      throw err;
    }
    const timeout = opts.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    return new OmcClient(proc, transport, timeout);
  }

  setCallTimeout(ms: number): void {
    this.callTimeoutMs = ms;
  }

  /**
   * The OMC version this package was last verified against. Static; doesn't
   * touch the running OMC. Useful at startup before the client has dialed.
   */
  static readonly supportedOmcVersion = SUPPORTED_OMC.primary;

  /**
   * Compare the connected OMC's version with this package's pinned target.
   * Returns "exact" / "minor-compatible" / "untested" / "unparseable" plus
   * the parsed runtime version. Doesn't throw; let callers decide whether
   * an "untested" verdict is acceptable for their use case.
   */
  async getVersionStatus(): Promise<CompatibilityReport> {
    const { version } = await this.getVersion();
    return compatibilityReport(version);
  }

  /**
   * Generic name-keyed dispatcher with full validation.
   *
   * - **Compile-time**: TypeScript narrows `input` to the exact shape for
   *   the chosen `fn` and the return type to the matching output.
   * - **Runtime**: the input is parsed against the function's Zod input
   *   schema (throws ZodError if it doesn't match), and the output is
   *   validated by the same `parseOutput` path the per-function methods use.
   *
   * Use this when input comes from an untrusted boundary — JSON-RPC, a
   * config file, a CLI, a plugin, a REPL. For trusted call sites where TS
   * already verifies the shape, prefer the dedicated method (e.g.
   * `client.getClassInformation(...)`) — it skips the redundant input parse.
   *
   * @example
   *   const { version } = await client.invoke("getVersion", {});
   *   const info = await client.invoke("getClassInformation", {
   *     typeName: "Modelica.Blocks.Math.Sin",
   *   });
   */
  async invoke<K extends OmcFnName>(
    fn: K,
    input: OmcInput<K>,
  ): Promise<OmcOutput<K>> {
    const entry = REGISTRY[fn];
    if (!entry) {
      throw new Error(`unknown OMC function: ${String(fn)}`);
    }
    const validated = entry.inputSchema.parse(input);
    // The registry pairs each fn with its matching input schema by
    // construction; TS's indexed-access generic narrowing can't see that, so
    // we erase to a generic call shape and re-tag the result.
    type AnyFn = (ctx: CallContext, input: unknown) => Promise<unknown>;
    const result = await (entry.fn as AnyFn)(this, validated);
    return result as OmcOutput<K>;
  }

  /**
   * Send a raw Modelica command string and return OMC's raw response.
   * Serializes against any other in-flight call.
   */
  async call(cmd: OmcCommand): Promise<string> {
    if (this.closed) throw new Error("omc client closed");
    // Record the raw command before we enqueue / send, so it's already
    // readable via `lastCall` even if the transport hangs or throws.
    this._lastCall = cmd;
    const prev = this.chain;
    let release!: () => void;
    this.chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await prev;
      return await this.transport.send(cmd, this.callTimeoutMs);
    } finally {
      release();
    }
  }

  /**
   * Run a command expected to return bool. On `false`, fetches getErrorString()
   * and surfaces it as an Error if non-empty. Used by mutation wrappers.
   */
  async callBool(cmd: OmcCommand): Promise<boolean> {
    const v = parse(await this.call(cmd));
    const b = expectBool(v);
    if (!b) {
      const { errorString } = await this.getErrorString();
      if (errorString.length > 0) {
        const head = cmd.split("(", 1)[0] ?? cmd;
        throw new Error(`${head}: ${errorString}`);
      }
    }
    return b;
  }

  /**
   * Best-effort clean shutdown: send `quit()`, close socket, kill subprocess.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.transport.send("quit()", 2_000);
    } catch {
      /* ignore */
    }
    await this.transport.close();
    await this.proc.stop();
  }

  // === Browsing ========================================================

  getVersion(input: browsing.GetVersionInput = {}): Promise<browsing.GetVersionOutput> {
    return browsing.getVersion(this, input);
  }

  getClassNames(
    input: browsing.GetClassNamesInput = {},
  ): Promise<browsing.GetClassNamesOutput> {
    return browsing.getClassNames(this, input);
  }

  searchClassNames(
    input: browsing.SearchClassNamesInput,
  ): Promise<browsing.SearchClassNamesOutput> {
    return browsing.searchClassNames(this, input);
  }

  getClassInformation(
    input: browsing.GetClassInformationInput,
  ): Promise<browsing.GetClassInformationOutput> {
    return browsing.getClassInformation(this, input);
  }

  isPackage(input: browsing.IsPackageInput): Promise<browsing.IsPackageOutput> {
    return browsing.isPackage(this, input);
  }

  getInheritanceCount(
    input: browsing.GetInheritanceCountInput,
  ): Promise<browsing.GetInheritanceCountOutput> {
    return browsing.getInheritanceCount(this, input);
  }

  getInheritedClasses(
    input: browsing.GetInheritedClassesInput,
  ): Promise<browsing.GetInheritedClassesOutput> {
    return browsing.getInheritedClasses(this, input);
  }

  getUses(input: browsing.GetUsesInput): Promise<browsing.GetUsesOutput> {
    return browsing.getUses(this, input);
  }

  existClass(input: browsing.ExistClassInput): Promise<browsing.ExistClassOutput> {
    return browsing.existClass(this, input);
  }

  getErrorString(
    input: browsing.GetErrorStringInput = {},
  ): Promise<browsing.GetErrorStringOutput> {
    return browsing.getErrorString(this, input);
  }

  getMessagesStringInternal(
    input: browsing.GetMessagesStringInternalInput = {},
  ): Promise<browsing.GetMessagesStringInternalOutput> {
    return browsing.getMessagesStringInternal(this, input);
  }

  existModel(
    input: browsing.ExistModelInput,
  ): Promise<browsing.ExistModelOutput> {
    return browsing.existModel(this, input);
  }

  existPackage(
    input: browsing.ExistPackageInput,
  ): Promise<browsing.ExistPackageOutput> {
    return browsing.existPackage(this, input);
  }

  getClassRestriction(
    input: browsing.GetClassRestrictionInput,
  ): Promise<browsing.GetClassRestrictionOutput> {
    return browsing.getClassRestriction(this, input);
  }

  getClassComment(
    input: browsing.GetClassCommentInput,
  ): Promise<browsing.GetClassCommentOutput> {
    return browsing.getClassComment(this, input);
  }

  isType(input: browsing.IsTypeInput): Promise<browsing.IsTypeOutput> {
    return browsing.isType(this, input);
  }

  isClass(input: browsing.IsClassInput): Promise<browsing.IsClassOutput> {
    return browsing.isClass(this, input);
  }

  isRecord(input: browsing.IsRecordInput): Promise<browsing.IsRecordOutput> {
    return browsing.isRecord(this, input);
  }

  isBlock(input: browsing.IsBlockInput): Promise<browsing.IsBlockOutput> {
    return browsing.isBlock(this, input);
  }

  isFunction(
    input: browsing.IsFunctionInput,
  ): Promise<browsing.IsFunctionOutput> {
    return browsing.isFunction(this, input);
  }

  isModel(input: browsing.IsModelInput): Promise<browsing.IsModelOutput> {
    return browsing.isModel(this, input);
  }

  isConnector(
    input: browsing.IsConnectorInput,
  ): Promise<browsing.IsConnectorOutput> {
    return browsing.isConnector(this, input);
  }

  isPartial(
    input: browsing.IsPartialInput,
  ): Promise<browsing.IsPartialOutput> {
    return browsing.isPartial(this, input);
  }

  isReplaceable(
    input: browsing.IsReplaceableInput,
  ): Promise<browsing.IsReplaceableOutput> {
    return browsing.isReplaceable(this, input);
  }

  isProtectedClass(
    input: browsing.IsProtectedClassInput,
  ): Promise<browsing.IsProtectedClassOutput> {
    return browsing.isProtectedClass(this, input);
  }

  isEnumeration(
    input: browsing.IsEnumerationInput,
  ): Promise<browsing.IsEnumerationOutput> {
    return browsing.isEnumeration(this, input);
  }

  getEnumerationLiterals(
    input: browsing.GetEnumerationLiteralsInput,
  ): Promise<browsing.GetEnumerationLiteralsOutput> {
    return browsing.getEnumerationLiterals(this, input);
  }

  getReplaceableChoices(
    input: browsing.GetReplaceableChoicesInput,
  ): Promise<browsing.GetReplaceableChoicesOutput> {
    return browsing.getReplaceableChoices(this, input);
  }

  extendsFrom(
    input: browsing.ExtendsFromInput,
  ): Promise<browsing.ExtendsFromOutput> {
    return browsing.extendsFrom(this, input);
  }

  getAllSubtypeOf(
    input: browsing.GetAllSubtypeOfInput,
  ): Promise<browsing.GetAllSubtypeOfOutput> {
    return browsing.getAllSubtypeOf(this, input);
  }

  classAnnotationExists(
    input: browsing.ClassAnnotationExistsInput,
  ): Promise<browsing.ClassAnnotationExistsOutput> {
    return browsing.classAnnotationExists(this, input);
  }

  getNthInheritedClass(
    input: browsing.GetNthInheritedClassInput,
  ): Promise<browsing.GetNthInheritedClassOutput> {
    return browsing.getNthInheritedClass(this, input);
  }

  isShortDefinition(
    input: browsing.IsShortDefinitionInput,
  ): Promise<browsing.IsShortDefinitionOutput> {
    return browsing.isShortDefinition(this, input);
  }

  // === Reading model contents =========================================

  getComponents(
    input: contents.GetComponentsInput,
  ): Promise<contents.GetComponentsOutput> {
    return contents.getComponents(this, input);
  }

  getComponentAnnotations(
    input: contents.GetComponentAnnotationsInput,
  ): Promise<contents.GetComponentAnnotationsOutput> {
    return contents.getComponentAnnotations(this, input);
  }

  getConnectionCount(
    input: contents.GetConnectionCountInput,
  ): Promise<contents.GetConnectionCountOutput> {
    return contents.getConnectionCount(this, input);
  }

  getNthConnection(
    input: contents.GetNthConnectionInput,
  ): Promise<contents.GetNthConnectionOutput> {
    return contents.getNthConnection(this, input);
  }

  getNthConnectionAnnotation(
    input: contents.GetNthConnectionAnnotationInput,
  ): Promise<contents.GetNthConnectionAnnotationOutput> {
    return contents.getNthConnectionAnnotation(this, input);
  }

  getTransitions(
    input: contents.GetTransitionsInput,
  ): Promise<contents.GetTransitionsOutput> {
    return contents.getTransitions(this, input);
  }

  getInitialStates(
    input: contents.GetInitialStatesInput,
  ): Promise<contents.GetInitialStatesOutput> {
    return contents.getInitialStates(this, input);
  }

  getIconAnnotation(
    input: contents.GetIconAnnotationInput,
  ): Promise<contents.GetIconAnnotationOutput> {
    return contents.getIconAnnotation(this, input);
  }

  getDiagramAnnotation(
    input: contents.GetDiagramAnnotationInput,
  ): Promise<contents.GetDiagramAnnotationOutput> {
    return contents.getDiagramAnnotation(this, input);
  }

  getDocumentationAnnotation(
    input: contents.GetDocumentationAnnotationInput,
  ): Promise<contents.GetDocumentationAnnotationOutput> {
    return contents.getDocumentationAnnotation(this, input);
  }

  listFile(input: contents.ListFileInput): Promise<contents.ListFileOutput> {
    return contents.listFile(this, input);
  }

  instantiateModel(
    input: contents.InstantiateModelInput,
  ): Promise<contents.InstantiateModelOutput> {
    return contents.instantiateModel(this, input);
  }

  getModelInstance(
    input: contents.GetModelInstanceInput,
  ): Promise<contents.GetModelInstanceOutput> {
    return contents.getModelInstance(this, input);
  }

  getModelInstanceAnnotation(
    input: contents.GetModelInstanceAnnotationInput,
  ): Promise<contents.GetModelInstanceAnnotationOutput> {
    return contents.getModelInstanceAnnotation(this, input);
  }

  modifierToJSON(
    input: contents.ModifierToJSONInput,
  ): Promise<contents.ModifierToJSONOutput> {
    return contents.modifierToJSON(this, input);
  }

  getConnectionList(
    input: contents.GetConnectionListInput,
  ): Promise<contents.GetConnectionListOutput> {
    return contents.getConnectionList(this, input);
  }

  getNthConnector(
    input: contents.GetNthConnectorInput,
  ): Promise<contents.GetNthConnectorOutput> {
    return contents.getNthConnector(this, input);
  }

  getNthConnectorIconAnnotation(
    input: contents.GetNthConnectorIconAnnotationInput,
  ): Promise<contents.GetNthConnectorIconAnnotationOutput> {
    return contents.getNthConnectorIconAnnotation(this, input);
  }

  getConnectorCount(
    input: contents.GetConnectorCountInput,
  ): Promise<contents.GetConnectorCountOutput> {
    return contents.getConnectorCount(this, input);
  }

  getNthInheritedClassIconMapAnnotation(
    input: contents.GetNthInheritedClassIconMapAnnotationInput,
  ): Promise<contents.GetNthInheritedClassIconMapAnnotationOutput> {
    return contents.getNthInheritedClassIconMapAnnotation(this, input);
  }

  getNthInheritedClassDiagramMapAnnotation(
    input: contents.GetNthInheritedClassDiagramMapAnnotationInput,
  ): Promise<contents.GetNthInheritedClassDiagramMapAnnotationOutput> {
    return contents.getNthInheritedClassDiagramMapAnnotation(this, input);
  }

  getDefaultComponentName(
    input: contents.GetDefaultComponentNameInput,
  ): Promise<contents.GetDefaultComponentNameOutput> {
    return contents.getDefaultComponentName(this, input);
  }

  getDefaultComponentPrefixes(
    input: contents.GetDefaultComponentPrefixesInput,
  ): Promise<contents.GetDefaultComponentPrefixesOutput> {
    return contents.getDefaultComponentPrefixes(this, input);
  }

  getComponentComment(
    input: contents.GetComponentCommentInput,
  ): Promise<contents.GetComponentCommentOutput> {
    return contents.getComponentComment(this, input);
  }

  getInstantiatedParametersAndValues(
    input: contents.GetInstantiatedParametersAndValuesInput,
  ): Promise<contents.GetInstantiatedParametersAndValuesOutput> {
    return contents.getInstantiatedParametersAndValues(this, input);
  }

  getAnnotationNamedModifiers(
    input: contents.GetAnnotationNamedModifiersInput,
  ): Promise<contents.GetAnnotationNamedModifiersOutput> {
    return contents.getAnnotationNamedModifiers(this, input);
  }

  getAnnotationModifierValue(
    input: contents.GetAnnotationModifierValueInput,
  ): Promise<contents.GetAnnotationModifierValueOutput> {
    return contents.getAnnotationModifierValue(this, input);
  }

  // === Lifecycle =======================================================

  loadFile(input: lifecycle.LoadFileInput): Promise<lifecycle.LoadFileOutput> {
    return lifecycle.loadFile(this, input);
  }

  loadString(
    input: lifecycle.LoadStringInput,
  ): Promise<lifecycle.LoadStringOutput> {
    return lifecycle.loadString(this, input);
  }

  loadModel(
    input: lifecycle.LoadModelInput,
  ): Promise<lifecycle.LoadModelOutput> {
    return lifecycle.loadModel(this, input);
  }

  parseFile(
    input: lifecycle.ParseFileInput,
  ): Promise<lifecycle.ParseFileOutput> {
    return lifecycle.parseFile(this, input);
  }

  parseString(
    input: lifecycle.ParseStringInput,
  ): Promise<lifecycle.ParseStringOutput> {
    return lifecycle.parseString(this, input);
  }

  createClass(
    input: lifecycle.CreateClassInput,
  ): Promise<lifecycle.CreateClassOutput> {
    return lifecycle.createClass(this, input);
  }

  createSubClass(
    input: lifecycle.CreateSubClassInput,
  ): Promise<lifecycle.CreateSubClassOutput> {
    return lifecycle.createSubClass(this, input);
  }

  renameClass(
    input: lifecycle.RenameClassInput,
  ): Promise<lifecycle.RenameClassOutput> {
    return lifecycle.renameClass(this, input);
  }

  deleteClass(
    input: lifecycle.DeleteClassInput,
  ): Promise<lifecycle.DeleteClassOutput> {
    return lifecycle.deleteClass(this, input);
  }

  copyClass(
    input: lifecycle.CopyClassInput,
  ): Promise<lifecycle.CopyClassOutput> {
    return lifecycle.copyClass(this, input);
  }

  moveClass(
    input: lifecycle.MoveClassInput,
  ): Promise<lifecycle.MoveClassOutput> {
    return lifecycle.moveClass(this, input);
  }

  moveClassToTop(
    input: lifecycle.MoveClassToTopInput,
  ): Promise<lifecycle.MoveClassToTopOutput> {
    return lifecycle.moveClassToTop(this, input);
  }

  moveClassToBottom(
    input: lifecycle.MoveClassToBottomInput,
  ): Promise<lifecycle.MoveClassToBottomOutput> {
    return lifecycle.moveClassToBottom(this, input);
  }

  getSourceFile(
    input: lifecycle.GetSourceFileInput,
  ): Promise<lifecycle.GetSourceFileOutput> {
    return lifecycle.getSourceFile(this, input);
  }

  setSourceFile(
    input: lifecycle.SetSourceFileInput,
  ): Promise<lifecycle.SetSourceFileOutput> {
    return lifecycle.setSourceFile(this, input);
  }

  diffModelicaFileListings(
    input: lifecycle.DiffModelicaFileListingsInput,
  ): Promise<lifecycle.DiffModelicaFileListingsOutput> {
    return lifecycle.diffModelicaFileListings(this, input);
  }

  save(input: lifecycle.SaveInput): Promise<lifecycle.SaveOutput> {
    return lifecycle.save(this, input);
  }

  cd(input: lifecycle.CdInput = {}): Promise<lifecycle.CdOutput> {
    return lifecycle.cd(this, input);
  }

  // === Parameters & modifiers ==========================================

  getParameterValue(
    input: parameters.GetParameterValueInput,
  ): Promise<parameters.GetParameterValueOutput> {
    return parameters.getParameterValue(this, input);
  }

  getComponentModifierNames(
    input: parameters.GetComponentModifierNamesInput,
  ): Promise<parameters.GetComponentModifierNamesOutput> {
    return parameters.getComponentModifierNames(this, input);
  }

  getComponentModifierValue(
    input: parameters.GetComponentModifierValueInput,
  ): Promise<parameters.GetComponentModifierValueOutput> {
    return parameters.getComponentModifierValue(this, input);
  }

  getComponentModifierValues(
    input: parameters.GetComponentModifierValuesInput,
  ): Promise<parameters.GetComponentModifierValuesOutput> {
    return parameters.getComponentModifierValues(this, input);
  }

  setComponentModifierValue(
    input: parameters.SetComponentModifierValueInput,
  ): Promise<parameters.SetComponentModifierValueOutput> {
    return parameters.setComponentModifierValue(this, input);
  }

  removeComponentModifiers(
    input: parameters.RemoveComponentModifiersInput,
  ): Promise<parameters.RemoveComponentModifiersOutput> {
    return parameters.removeComponentModifiers(this, input);
  }

  getExtendsModifierNames(
    input: parameters.GetExtendsModifierNamesInput,
  ): Promise<parameters.GetExtendsModifierNamesOutput> {
    return parameters.getExtendsModifierNames(this, input);
  }

  getExtendsModifierValue(
    input: parameters.GetExtendsModifierValueInput,
  ): Promise<parameters.GetExtendsModifierValueOutput> {
    return parameters.getExtendsModifierValue(this, input);
  }

  setExtendsModifierValue(
    input: parameters.SetExtendsModifierValueInput,
  ): Promise<parameters.SetExtendsModifierValueOutput> {
    return parameters.setExtendsModifierValue(this, input);
  }

  getParameterNames(
    input: parameters.GetParameterNamesInput,
  ): Promise<parameters.GetParameterNamesOutput> {
    return parameters.getParameterNames(this, input);
  }

  setParameterValue(
    input: parameters.SetParameterValueInput,
  ): Promise<parameters.SetParameterValueOutput> {
    return parameters.setParameterValue(this, input);
  }

  removeExtendsModifiers(
    input: parameters.RemoveExtendsModifiersInput,
  ): Promise<parameters.RemoveExtendsModifiersOutput> {
    return parameters.removeExtendsModifiers(this, input);
  }

  // === Elements ========================================================

  getElements(
    input: elements.GetElementsInput,
  ): Promise<elements.GetElementsOutput> {
    return elements.getElements(this, input);
  }

  getElementsInfo(
    input: elements.GetElementsInfoInput,
  ): Promise<elements.GetElementsInfoOutput> {
    return elements.getElementsInfo(this, input);
  }

  getElementAnnotation(
    input: elements.GetElementAnnotationInput,
  ): Promise<elements.GetElementAnnotationOutput> {
    return elements.getElementAnnotation(this, input);
  }

  getElementAnnotations(
    input: elements.GetElementAnnotationsInput,
  ): Promise<elements.GetElementAnnotationsOutput> {
    return elements.getElementAnnotations(this, input);
  }

  getElementModifierNames(
    input: elements.GetElementModifierNamesInput,
  ): Promise<elements.GetElementModifierNamesOutput> {
    return elements.getElementModifierNames(this, input);
  }

  getElementModifierValue(
    input: elements.GetElementModifierValueInput,
  ): Promise<elements.GetElementModifierValueOutput> {
    return elements.getElementModifierValue(this, input);
  }

  getElementModifierValues(
    input: elements.GetElementModifierValuesInput,
  ): Promise<elements.GetElementModifierValuesOutput> {
    return elements.getElementModifierValues(this, input);
  }

  setElementModifierValue(
    input: elements.SetElementModifierValueInput,
  ): Promise<elements.SetElementModifierValueOutput> {
    return elements.setElementModifierValue(this, input);
  }

  setElementAnnotation(
    input: elements.SetElementAnnotationInput,
  ): Promise<elements.SetElementAnnotationOutput> {
    return elements.setElementAnnotation(this, input);
  }

  setElementType(
    input: elements.SetElementTypeInput,
  ): Promise<elements.SetElementTypeOutput> {
    return elements.setElementType(this, input);
  }

  removeElementModifiers(
    input: elements.RemoveElementModifiersInput,
  ): Promise<elements.RemoveElementModifiersOutput> {
    return elements.removeElementModifiers(this, input);
  }

  // === Library / package management ===================================

  getAvailableLibraries(
    input: library.GetAvailableLibrariesInput = {},
  ): Promise<library.GetAvailableLibrariesOutput> {
    return library.getAvailableLibraries(this, input);
  }

  getAvailableLibraryVersions(
    input: library.GetAvailableLibraryVersionsInput,
  ): Promise<library.GetAvailableLibraryVersionsOutput> {
    return library.getAvailableLibraryVersions(this, input);
  }

  getAvailablePackageVersions(
    input: library.GetAvailablePackageVersionsInput,
  ): Promise<library.GetAvailablePackageVersionsOutput> {
    return library.getAvailablePackageVersions(this, input);
  }

  installPackage(
    input: library.InstallPackageInput,
  ): Promise<library.InstallPackageOutput> {
    return library.installPackage(this, input);
  }

  updatePackageIndex(
    input: library.UpdatePackageIndexInput = {},
  ): Promise<library.UpdatePackageIndexOutput> {
    return library.updatePackageIndex(this, input);
  }

  upgradeInstalledPackages(
    input: library.UpgradeInstalledPackagesInput = {},
  ): Promise<library.UpgradeInstalledPackagesOutput> {
    return library.upgradeInstalledPackages(this, input);
  }

  getLoadedLibraries(
    input: library.GetLoadedLibrariesInput = {},
  ): Promise<library.GetLoadedLibrariesOutput> {
    return library.getLoadedLibraries(this, input);
  }

  getPackages(
    input: library.GetPackagesInput = {},
  ): Promise<library.GetPackagesOutput> {
    return library.getPackages(this, input);
  }

  loadFiles(
    input: library.LoadFilesInput,
  ): Promise<library.LoadFilesOutput> {
    return library.loadFiles(this, input);
  }

  // === Solver / runtime config =========================================

  getSolverMethods(
    input: solver.GetSolverMethodsInput = {},
  ): Promise<solver.GetSolverMethodsOutput> {
    return solver.getSolverMethods(this, input);
  }

  getJacobianMethods(
    input: solver.GetJacobianMethodsInput = {},
  ): Promise<solver.GetJacobianMethodsOutput> {
    return solver.getJacobianMethods(this, input);
  }

  getInitializationMethods(
    input: solver.GetInitializationMethodsInput = {},
  ): Promise<solver.GetInitializationMethodsOutput> {
    return solver.getInitializationMethods(this, input);
  }

  getLinearSolvers(
    input: solver.GetLinearSolversInput = {},
  ): Promise<solver.GetLinearSolversOutput> {
    return solver.getLinearSolvers(this, input);
  }

  getNonLinearSolvers(
    input: solver.GetNonLinearSolversInput = {},
  ): Promise<solver.GetNonLinearSolversOutput> {
    return solver.getNonLinearSolvers(this, input);
  }

  setMatchingAlgorithm(
    input: solver.SetMatchingAlgorithmInput,
  ): Promise<solver.SetMatchingAlgorithmOutput> {
    return solver.setMatchingAlgorithm(this, input);
  }

  setIndexReductionMethod(
    input: solver.SetIndexReductionMethodInput,
  ): Promise<solver.SetIndexReductionMethodOutput> {
    return solver.setIndexReductionMethod(this, input);
  }

  setCommandLineOptions(
    input: solver.SetCommandLineOptionsInput,
  ): Promise<solver.SetCommandLineOptionsOutput> {
    return solver.setCommandLineOptions(this, input);
  }

  // === Editing =========================================================

  addComponent(
    input: editing.AddComponentInput,
  ): Promise<editing.AddComponentOutput> {
    return editing.addComponent(this, input);
  }

  deleteComponent(
    input: editing.DeleteComponentInput,
  ): Promise<editing.DeleteComponentOutput> {
    return editing.deleteComponent(this, input);
  }

  renameComponent(
    input: editing.RenameComponentInput,
  ): Promise<editing.RenameComponentOutput> {
    return editing.renameComponent(this, input);
  }

  updateComponent(
    input: editing.UpdateComponentInput,
  ): Promise<editing.UpdateComponentOutput> {
    return editing.updateComponent(this, input);
  }

  addConnection(
    input: editing.AddConnectionInput,
  ): Promise<editing.AddConnectionOutput> {
    return editing.addConnection(this, input);
  }

  deleteConnection(
    input: editing.DeleteConnectionInput,
  ): Promise<editing.DeleteConnectionOutput> {
    return editing.deleteConnection(this, input);
  }

  updateConnection(
    input: editing.UpdateConnectionInput,
  ): Promise<editing.UpdateConnectionOutput> {
    return editing.updateConnection(this, input);
  }

  addTransition(
    input: editing.AddTransitionInput,
  ): Promise<editing.AddTransitionOutput> {
    return editing.addTransition(this, input);
  }

  deleteTransition(
    input: editing.DeleteTransitionInput,
  ): Promise<editing.DeleteTransitionOutput> {
    return editing.deleteTransition(this, input);
  }

  addClassAnnotation(
    input: editing.AddClassAnnotationInput,
  ): Promise<editing.AddClassAnnotationOutput> {
    return editing.addClassAnnotation(this, input);
  }

  setComponentProperties(
    input: editing.SetComponentPropertiesInput,
  ): Promise<editing.SetComponentPropertiesOutput> {
    return editing.setComponentProperties(this, input);
  }

  setComponentDimensions(
    input: editing.SetComponentDimensionsInput,
  ): Promise<editing.SetComponentDimensionsOutput> {
    return editing.setComponentDimensions(this, input);
  }

  setComponentComment(
    input: editing.SetComponentCommentInput,
  ): Promise<editing.SetComponentCommentOutput> {
    return editing.setComponentComment(this, input);
  }

  setClassComment(
    input: editing.SetClassCommentInput,
  ): Promise<editing.SetClassCommentOutput> {
    return editing.setClassComment(this, input);
  }

  setDocumentationAnnotation(
    input: editing.SetDocumentationAnnotationInput,
  ): Promise<editing.SetDocumentationAnnotationOutput> {
    return editing.setDocumentationAnnotation(this, input);
  }

  addInitialState(
    input: editing.AddInitialStateInput,
  ): Promise<editing.AddInitialStateOutput> {
    return editing.addInitialState(this, input);
  }

  deleteInitialState(
    input: editing.DeleteInitialStateInput,
  ): Promise<editing.DeleteInitialStateOutput> {
    return editing.deleteInitialState(this, input);
  }

  updateInitialState(
    input: editing.UpdateInitialStateInput,
  ): Promise<editing.UpdateInitialStateOutput> {
    return editing.updateInitialState(this, input);
  }

  renameComponentInClass(
    input: editing.RenameComponentInClassInput,
  ): Promise<editing.RenameComponentInClassOutput> {
    return editing.renameComponentInClass(this, input);
  }

  // === Execution =======================================================

  checkModel(
    input: execution.CheckModelInput,
  ): Promise<execution.CheckModelOutput> {
    return execution.checkModel(this, input);
  }

  translateModel(
    input: execution.TranslateModelInput,
  ): Promise<execution.TranslateModelOutput> {
    return execution.translateModel(this, input);
  }

  buildModel(
    input: execution.BuildModelInput,
  ): Promise<execution.BuildModelOutput> {
    return execution.buildModel(this, input);
  }

  simulate(
    input: execution.SimulateInput,
  ): Promise<execution.SimulateOutput> {
    return execution.simulate(this, input);
  }

  buildModelFMU(
    input: execution.BuildModelFMUInput,
  ): Promise<execution.BuildModelFMUOutput> {
    return execution.buildModelFMU(this, input);
  }

  translateModelXML(
    input: execution.TranslateModelXMLInput,
  ): Promise<execution.TranslateModelXMLOutput> {
    return execution.translateModelXML(this, input);
  }

  importFMU(
    input: execution.ImportFMUInput,
  ): Promise<execution.ImportFMUOutput> {
    return execution.importFMU(this, input);
  }

  getSimulationOptions(
    input: execution.GetSimulationOptionsInput,
  ): Promise<execution.GetSimulationOptionsOutput> {
    return execution.getSimulationOptions(this, input);
  }

  isExperiment(
    input: execution.IsExperimentInput,
  ): Promise<execution.IsExperimentOutput> {
    return execution.isExperiment(this, input);
  }

  // === Results =========================================================

  readSimulationResultSize(
    input: results.ReadSimulationResultSizeInput,
  ): Promise<results.ReadSimulationResultSizeOutput> {
    return results.readSimulationResultSize(this, input);
  }

  readSimulationResultVars(
    input: results.ReadSimulationResultVarsInput,
  ): Promise<results.ReadSimulationResultVarsOutput> {
    return results.readSimulationResultVars(this, input);
  }

  closeSimulationResultFile(
    input: results.CloseSimulationResultFileInput = {},
  ): Promise<results.CloseSimulationResultFileOutput> {
    return results.closeSimulationResultFile(this, input);
  }

  readSimulationResult(
    input: results.ReadSimulationResultInput,
  ): Promise<results.ReadSimulationResultOutput> {
    return results.readSimulationResult(this, input);
  }

  val(input: results.ValInput): Promise<results.ValOutput> {
    return results.val(this, input);
  }

  filterSimulationResults(
    input: results.FilterSimulationResultsInput,
  ): Promise<results.FilterSimulationResultsOutput> {
    return results.filterSimulationResults(this, input);
  }

  compareSimulationResults(
    input: results.CompareSimulationResultsInput,
  ): Promise<results.CompareSimulationResultsOutput> {
    return results.compareSimulationResults(this, input);
  }

  deltaSimulationResults(
    input: results.DeltaSimulationResultsInput,
  ): Promise<results.DeltaSimulationResultsOutput> {
    return results.deltaSimulationResults(this, input);
  }

  diffSimulationResults(
    input: results.DiffSimulationResultsInput,
  ): Promise<results.DiffSimulationResultsOutput> {
    return results.diffSimulationResults(this, input);
  }
}
