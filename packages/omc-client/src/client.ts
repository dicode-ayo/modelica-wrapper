/**
 * OmcClient — typed, schema-validated client for OpenModelica's interactive
 * ZeroMQ scripting API.
 *
 * - Single OMC subprocess + REQ socket per instance
 * - All calls serialize through a single-slot queue (OMC is single-threaded)
 * - Each method delegates to a per-function module in `./api/<category>/<fn>.ts`
 *   that owns its Zod input/output schemas
 *
 * Functional API consumers can also call those modules directly with a
 * `CallContext` they construct themselves.
 */

import type { CallContext } from "./_shared/callContext.js";
import type { OmcCommand } from "./commands.js";
import { mutationFor, type OmcMutation } from "./mutation.js";
import { spawnOmc, type OmcProcess } from "./process.js";
import { OmcTransport } from "./transport.js";
import { SerialQueue } from "./queue.js";

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

/** Reacts to a mutation OMC just accepted. Must not throw to be correct. */
export type MutationListener = (mutation: OmcMutation) => void;

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

  /** OMC's REQ/REP socket admits one round-trip at a time. */
  private readonly queue = new SerialQueue();
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
  private readonly mutationListeners = new Set<MutationListener>();

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
   * Every dedicated method delegates here, so this is the one place an input
   * is checked and `client.getClassInformation(...)` is a named spelling of
   * the same call rather than a way around it. Call it directly when the
   * function name is itself data — a JSON-RPC dispatch, a REPL, a plugin.
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
    const reply = await this.queue.run(() =>
      this.transport.send(cmd, this.callTimeoutMs),
    );
    // Outside the queue slot: a listener that asks OMC anything would
    // otherwise wait for a slot the announcement is still holding.
    this.announce(cmd);
    return reply;
  }

  /**
   * Subscribe to mutations this client accepts. Returns an unsubscribe
   * function.
   *
   * A subscription belongs to one client and dies with it, so a caller that
   * replaces its client — closing this one and spawning another — must
   * subscribe again on the new one.
   */
  onMutation(listener: MutationListener): () => void {
    this.mutationListeners.add(listener);
    return () => {
      this.mutationListeners.delete(listener);
    };
  }

  /**
   * Announce whatever `cmd` may have changed. Fired whenever the call did not
   * throw, because success is unreadable here — `call()` holds only OMC's raw
   * reply text, and even the wrapper one layer up cannot settle it:
   * `addComponent` answers `false` with an error line and may still have
   * touched the AST.
   *
   * A throw is swallowed. A listener left un-run because a sibling failed is
   * the staleness this exists to prevent, and this package has no logging
   * channel to report it through.
   */
  private announce(cmd: string): void {
    if (this.mutationListeners.size === 0) return;
    const mutation = mutationFor(cmd);
    if (mutation === undefined) return;
    for (const listener of [...this.mutationListeners]) {
      try {
        listener(mutation);
      } catch {
        /* ignore */
      }
    }
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

  getVersion(
    input: browsing.GetVersionInput = {},
  ): Promise<browsing.GetVersionOutput> {
    return browsing.getVersion(this, input);
  }

  getModelicaPath(): Promise<browsing.GetModelicaPathOutput> {
    return browsing.getModelicaPath(this);
  }

  getClassNames(
    input: browsing.GetClassNamesInput = {},
  ): Promise<browsing.GetClassNamesOutput> {
    return browsing.getClassNames(this, input);
  }

  searchClassNames(
    input: browsing.SearchClassNamesInput,
  ): Promise<browsing.SearchClassNamesOutput> {
    return this.invoke("searchClassNames", input);
  }

  getClassInformation(
    input: browsing.GetClassInformationInput,
  ): Promise<browsing.GetClassInformationOutput> {
    return this.invoke("getClassInformation", input);
  }

  isPackage(input: browsing.IsPackageInput): Promise<browsing.IsPackageOutput> {
    return this.invoke("isPackage", input);
  }

  getInheritanceCount(
    input: browsing.GetInheritanceCountInput,
  ): Promise<browsing.GetInheritanceCountOutput> {
    return this.invoke("getInheritanceCount", input);
  }

  getInheritedClasses(
    input: browsing.GetInheritedClassesInput,
  ): Promise<browsing.GetInheritedClassesOutput> {
    return this.invoke("getInheritedClasses", input);
  }

  getUses(input: browsing.GetUsesInput): Promise<browsing.GetUsesOutput> {
    return this.invoke("getUses", input);
  }

  existClass(
    input: browsing.ExistClassInput,
  ): Promise<browsing.ExistClassOutput> {
    return this.invoke("existClass", input);
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
    return this.invoke("existModel", input);
  }

  existPackage(
    input: browsing.ExistPackageInput,
  ): Promise<browsing.ExistPackageOutput> {
    return this.invoke("existPackage", input);
  }

  getClassRestriction(
    input: browsing.GetClassRestrictionInput,
  ): Promise<browsing.GetClassRestrictionOutput> {
    return this.invoke("getClassRestriction", input);
  }

  getClassComment(
    input: browsing.GetClassCommentInput,
  ): Promise<browsing.GetClassCommentOutput> {
    return this.invoke("getClassComment", input);
  }

  isType(input: browsing.IsTypeInput): Promise<browsing.IsTypeOutput> {
    return this.invoke("isType", input);
  }

  isClass(input: browsing.IsClassInput): Promise<browsing.IsClassOutput> {
    return this.invoke("isClass", input);
  }

  isRecord(input: browsing.IsRecordInput): Promise<browsing.IsRecordOutput> {
    return this.invoke("isRecord", input);
  }

  isBlock(input: browsing.IsBlockInput): Promise<browsing.IsBlockOutput> {
    return this.invoke("isBlock", input);
  }

  isFunction(
    input: browsing.IsFunctionInput,
  ): Promise<browsing.IsFunctionOutput> {
    return this.invoke("isFunction", input);
  }

  isModel(input: browsing.IsModelInput): Promise<browsing.IsModelOutput> {
    return this.invoke("isModel", input);
  }

  isConnector(
    input: browsing.IsConnectorInput,
  ): Promise<browsing.IsConnectorOutput> {
    return this.invoke("isConnector", input);
  }

  isPartial(input: browsing.IsPartialInput): Promise<browsing.IsPartialOutput> {
    return this.invoke("isPartial", input);
  }

  isReplaceable(
    input: browsing.IsReplaceableInput,
  ): Promise<browsing.IsReplaceableOutput> {
    return this.invoke("isReplaceable", input);
  }

  isProtectedClass(
    input: browsing.IsProtectedClassInput,
  ): Promise<browsing.IsProtectedClassOutput> {
    return this.invoke("isProtectedClass", input);
  }

  isEnumeration(
    input: browsing.IsEnumerationInput,
  ): Promise<browsing.IsEnumerationOutput> {
    return this.invoke("isEnumeration", input);
  }

  isConstant(
    input: browsing.IsConstantInput,
  ): Promise<browsing.IsConstantOutput> {
    return this.invoke("isConstant", input);
  }

  isParameter(
    input: browsing.IsParameterInput,
  ): Promise<browsing.IsParameterOutput> {
    return this.invoke("isParameter", input);
  }

  isProtected(
    input: browsing.IsProtectedInput,
  ): Promise<browsing.IsProtectedOutput> {
    return this.invoke("isProtected", input);
  }

  isRedeclare(
    input: browsing.IsRedeclareInput,
  ): Promise<browsing.IsRedeclareOutput> {
    return this.invoke("isRedeclare", input);
  }

  isPrimitive(
    input: browsing.IsPrimitiveInput,
  ): Promise<browsing.IsPrimitiveOutput> {
    return this.invoke("isPrimitive", input);
  }

  isOperator(
    input: browsing.IsOperatorInput,
  ): Promise<browsing.IsOperatorOutput> {
    return this.invoke("isOperator", input);
  }

  isOperatorFunction(
    input: browsing.IsOperatorFunctionInput,
  ): Promise<browsing.IsOperatorFunctionOutput> {
    return this.invoke("isOperatorFunction", input);
  }

  isOperatorRecord(
    input: browsing.IsOperatorRecordInput,
  ): Promise<browsing.IsOperatorRecordOutput> {
    return this.invoke("isOperatorRecord", input);
  }

  isOptimization(
    input: browsing.IsOptimizationInput,
  ): Promise<browsing.IsOptimizationOutput> {
    return this.invoke("isOptimization", input);
  }

  getEnumerationLiterals(
    input: browsing.GetEnumerationLiteralsInput,
  ): Promise<browsing.GetEnumerationLiteralsOutput> {
    return this.invoke("getEnumerationLiterals", input);
  }

  getReplaceableChoices(
    input: browsing.GetReplaceableChoicesInput,
  ): Promise<browsing.GetReplaceableChoicesOutput> {
    return this.invoke("getReplaceableChoices", input);
  }

  extendsFrom(
    input: browsing.ExtendsFromInput,
  ): Promise<browsing.ExtendsFromOutput> {
    return this.invoke("extendsFrom", input);
  }

  getAllSubtypeOf(
    input: browsing.GetAllSubtypeOfInput,
  ): Promise<browsing.GetAllSubtypeOfOutput> {
    return this.invoke("getAllSubtypeOf", input);
  }

  classAnnotationExists(
    input: browsing.ClassAnnotationExistsInput,
  ): Promise<browsing.ClassAnnotationExistsOutput> {
    return this.invoke("classAnnotationExists", input);
  }

  getNthInheritedClass(
    input: browsing.GetNthInheritedClassInput,
  ): Promise<browsing.GetNthInheritedClassOutput> {
    return this.invoke("getNthInheritedClass", input);
  }

  isShortDefinition(
    input: browsing.IsShortDefinitionInput,
  ): Promise<browsing.IsShortDefinitionOutput> {
    return this.invoke("isShortDefinition", input);
  }

  // === Reading model contents =========================================

  getComponents(
    input: contents.GetComponentsInput,
  ): Promise<contents.GetComponentsOutput> {
    return this.invoke("getComponents", input);
  }

  getComponentAnnotations(
    input: contents.GetComponentAnnotationsInput,
  ): Promise<contents.GetComponentAnnotationsOutput> {
    return this.invoke("getComponentAnnotations", input);
  }

  getConnectionCount(
    input: contents.GetConnectionCountInput,
  ): Promise<contents.GetConnectionCountOutput> {
    return this.invoke("getConnectionCount", input);
  }

  getNthConnection(
    input: contents.GetNthConnectionInput,
  ): Promise<contents.GetNthConnectionOutput> {
    return this.invoke("getNthConnection", input);
  }

  getNthConnectionAnnotation(
    input: contents.GetNthConnectionAnnotationInput,
  ): Promise<contents.GetNthConnectionAnnotationOutput> {
    return this.invoke("getNthConnectionAnnotation", input);
  }

  getTransitions(
    input: contents.GetTransitionsInput,
  ): Promise<contents.GetTransitionsOutput> {
    return this.invoke("getTransitions", input);
  }

  getInitialStates(
    input: contents.GetInitialStatesInput,
  ): Promise<contents.GetInitialStatesOutput> {
    return this.invoke("getInitialStates", input);
  }

  getIconAnnotation(
    input: contents.GetIconAnnotationInput,
  ): Promise<contents.GetIconAnnotationOutput> {
    return this.invoke("getIconAnnotation", input);
  }

  getDiagramAnnotation(
    input: contents.GetDiagramAnnotationInput,
  ): Promise<contents.GetDiagramAnnotationOutput> {
    return this.invoke("getDiagramAnnotation", input);
  }

  getDocumentationAnnotation(
    input: contents.GetDocumentationAnnotationInput,
  ): Promise<contents.GetDocumentationAnnotationOutput> {
    return this.invoke("getDocumentationAnnotation", input);
  }

  listFile(input: contents.ListFileInput): Promise<contents.ListFileOutput> {
    return this.invoke("listFile", input);
  }

  instantiateModel(
    input: contents.InstantiateModelInput,
  ): Promise<contents.InstantiateModelOutput> {
    return this.invoke("instantiateModel", input);
  }

  getModelInstance(
    input: contents.GetModelInstanceInput,
  ): Promise<contents.GetModelInstanceOutput> {
    return this.invoke("getModelInstance", input);
  }

  getModelInstanceAnnotation(
    input: contents.GetModelInstanceAnnotationInput,
  ): Promise<contents.GetModelInstanceAnnotationOutput> {
    return this.invoke("getModelInstanceAnnotation", input);
  }

  modifierToJSON(
    input: contents.ModifierToJSONInput,
  ): Promise<contents.ModifierToJSONOutput> {
    return this.invoke("modifierToJSON", input);
  }

  getConnectionList(
    input: contents.GetConnectionListInput,
  ): Promise<contents.GetConnectionListOutput> {
    return this.invoke("getConnectionList", input);
  }

  getNthConnector(
    input: contents.GetNthConnectorInput,
  ): Promise<contents.GetNthConnectorOutput> {
    return this.invoke("getNthConnector", input);
  }

  getNthConnectorIconAnnotation(
    input: contents.GetNthConnectorIconAnnotationInput,
  ): Promise<contents.GetNthConnectorIconAnnotationOutput> {
    return this.invoke("getNthConnectorIconAnnotation", input);
  }

  getConnectorCount(
    input: contents.GetConnectorCountInput,
  ): Promise<contents.GetConnectorCountOutput> {
    return this.invoke("getConnectorCount", input);
  }

  getNthInheritedClassIconMapAnnotation(
    input: contents.GetNthInheritedClassIconMapAnnotationInput,
  ): Promise<contents.GetNthInheritedClassIconMapAnnotationOutput> {
    return this.invoke("getNthInheritedClassIconMapAnnotation", input);
  }

  getNthInheritedClassDiagramMapAnnotation(
    input: contents.GetNthInheritedClassDiagramMapAnnotationInput,
  ): Promise<contents.GetNthInheritedClassDiagramMapAnnotationOutput> {
    return this.invoke("getNthInheritedClassDiagramMapAnnotation", input);
  }

  getDefaultComponentName(
    input: contents.GetDefaultComponentNameInput,
  ): Promise<contents.GetDefaultComponentNameOutput> {
    return this.invoke("getDefaultComponentName", input);
  }

  getDefaultComponentPrefixes(
    input: contents.GetDefaultComponentPrefixesInput,
  ): Promise<contents.GetDefaultComponentPrefixesOutput> {
    return this.invoke("getDefaultComponentPrefixes", input);
  }

  getComponentComment(
    input: contents.GetComponentCommentInput,
  ): Promise<contents.GetComponentCommentOutput> {
    return this.invoke("getComponentComment", input);
  }

  getInstantiatedParametersAndValues(
    input: contents.GetInstantiatedParametersAndValuesInput,
  ): Promise<contents.GetInstantiatedParametersAndValuesOutput> {
    return this.invoke("getInstantiatedParametersAndValues", input);
  }

  getAnnotationNamedModifiers(
    input: contents.GetAnnotationNamedModifiersInput,
  ): Promise<contents.GetAnnotationNamedModifiersOutput> {
    return this.invoke("getAnnotationNamedModifiers", input);
  }

  getAnnotationModifierValue(
    input: contents.GetAnnotationModifierValueInput,
  ): Promise<contents.GetAnnotationModifierValueOutput> {
    return this.invoke("getAnnotationModifierValue", input);
  }

  getComponentCount(
    input: contents.GetComponentCountInput,
  ): Promise<contents.GetComponentCountOutput> {
    return this.invoke("getComponentCount", input);
  }

  getNthComponent(
    input: contents.GetNthComponentInput,
  ): Promise<contents.GetNthComponentOutput> {
    return this.invoke("getNthComponent", input);
  }

  getNthComponentAnnotation(
    input: contents.GetNthComponentAnnotationInput,
  ): Promise<contents.GetNthComponentAnnotationOutput> {
    return this.invoke("getNthComponentAnnotation", input);
  }

  getNthComponentCondition(
    input: contents.GetNthComponentConditionInput,
  ): Promise<contents.GetNthComponentConditionOutput> {
    return this.invoke("getNthComponentCondition", input);
  }

  getNthComponentModification(
    input: contents.GetNthComponentModificationInput,
  ): Promise<contents.GetNthComponentModificationOutput> {
    return this.invoke("getNthComponentModification", input);
  }

  getAnnotationCount(
    input: contents.GetAnnotationCountInput,
  ): Promise<contents.GetAnnotationCountOutput> {
    return this.invoke("getAnnotationCount", input);
  }

  getNthAnnotationString(
    input: contents.GetNthAnnotationStringInput,
  ): Promise<contents.GetNthAnnotationStringOutput> {
    return this.invoke("getNthAnnotationString", input);
  }

  getAlgorithmCount(
    input: contents.GetAlgorithmCountInput,
  ): Promise<contents.GetAlgorithmCountOutput> {
    return this.invoke("getAlgorithmCount", input);
  }

  getNthAlgorithm(
    input: contents.GetNthAlgorithmInput,
  ): Promise<contents.GetNthAlgorithmOutput> {
    return this.invoke("getNthAlgorithm", input);
  }

  getAlgorithmItemsCount(
    input: contents.GetAlgorithmItemsCountInput,
  ): Promise<contents.GetAlgorithmItemsCountOutput> {
    return this.invoke("getAlgorithmItemsCount", input);
  }

  getNthAlgorithmItem(
    input: contents.GetNthAlgorithmItemInput,
  ): Promise<contents.GetNthAlgorithmItemOutput> {
    return this.invoke("getNthAlgorithmItem", input);
  }

  getInitialAlgorithmCount(
    input: contents.GetInitialAlgorithmCountInput,
  ): Promise<contents.GetInitialAlgorithmCountOutput> {
    return this.invoke("getInitialAlgorithmCount", input);
  }

  getNthInitialAlgorithm(
    input: contents.GetNthInitialAlgorithmInput,
  ): Promise<contents.GetNthInitialAlgorithmOutput> {
    return this.invoke("getNthInitialAlgorithm", input);
  }

  getInitialAlgorithmItemsCount(
    input: contents.GetInitialAlgorithmItemsCountInput,
  ): Promise<contents.GetInitialAlgorithmItemsCountOutput> {
    return this.invoke("getInitialAlgorithmItemsCount", input);
  }

  getNthInitialAlgorithmItem(
    input: contents.GetNthInitialAlgorithmItemInput,
  ): Promise<contents.GetNthInitialAlgorithmItemOutput> {
    return this.invoke("getNthInitialAlgorithmItem", input);
  }

  getNthEquation(
    input: contents.GetNthEquationInput,
  ): Promise<contents.GetNthEquationOutput> {
    return this.invoke("getNthEquation", input);
  }

  getNthEquationItem(
    input: contents.GetNthEquationItemInput,
  ): Promise<contents.GetNthEquationItemOutput> {
    return this.invoke("getNthEquationItem", input);
  }

  getInitialEquationCount(
    input: contents.GetInitialEquationCountInput,
  ): Promise<contents.GetInitialEquationCountOutput> {
    return this.invoke("getInitialEquationCount", input);
  }

  getNthInitialEquation(
    input: contents.GetNthInitialEquationInput,
  ): Promise<contents.GetNthInitialEquationOutput> {
    return this.invoke("getNthInitialEquation", input);
  }

  getInitialEquationItemsCount(
    input: contents.GetInitialEquationItemsCountInput,
  ): Promise<contents.GetInitialEquationItemsCountOutput> {
    return this.invoke("getInitialEquationItemsCount", input);
  }

  getNthInitialEquationItem(
    input: contents.GetNthInitialEquationItemInput,
  ): Promise<contents.GetNthInitialEquationItemOutput> {
    return this.invoke("getNthInitialEquationItem", input);
  }

  getImportCount(
    input: contents.GetImportCountInput,
  ): Promise<contents.GetImportCountOutput> {
    return this.invoke("getImportCount", input);
  }

  getNthImport(
    input: contents.GetNthImportInput,
  ): Promise<contents.GetNthImportOutput> {
    return this.invoke("getNthImport", input);
  }

  convertUnits(
    input: contents.ConvertUnitsInput,
  ): Promise<contents.ConvertUnitsOutput> {
    return this.invoke("convertUnits", input);
  }

  getDerivedUnits(
    input: contents.GetDerivedUnitsInput,
  ): Promise<contents.GetDerivedUnitsOutput> {
    return this.invoke("getDerivedUnits", input);
  }

  uriToFilename(
    input: contents.UriToFilenameInput,
  ): Promise<contents.UriToFilenameOutput> {
    return this.invoke("uriToFilename", input);
  }

  qualifyPath(
    input: contents.QualifyPathInput,
  ): Promise<contents.QualifyPathOutput> {
    return this.invoke("qualifyPath", input);
  }

  // === Lifecycle =======================================================

  loadFile(input: lifecycle.LoadFileInput): Promise<lifecycle.LoadFileOutput> {
    return this.invoke("loadFile", input);
  }

  loadString(
    input: lifecycle.LoadStringInput,
  ): Promise<lifecycle.LoadStringOutput> {
    return this.invoke("loadString", input);
  }

  loadModel(
    input: lifecycle.LoadModelInput,
  ): Promise<lifecycle.LoadModelOutput> {
    return this.invoke("loadModel", input);
  }

  parseFile(
    input: lifecycle.ParseFileInput,
  ): Promise<lifecycle.ParseFileOutput> {
    return this.invoke("parseFile", input);
  }

  parseString(
    input: lifecycle.ParseStringInput,
  ): Promise<lifecycle.ParseStringOutput> {
    return this.invoke("parseString", input);
  }

  newModel(input: lifecycle.NewModelInput): Promise<lifecycle.NewModelOutput> {
    return this.invoke("newModel", input);
  }

  renameClass(
    input: lifecycle.RenameClassInput,
  ): Promise<lifecycle.RenameClassOutput> {
    return this.invoke("renameClass", input);
  }

  deleteClass(
    input: lifecycle.DeleteClassInput,
  ): Promise<lifecycle.DeleteClassOutput> {
    return this.invoke("deleteClass", input);
  }

  copyClass(
    input: lifecycle.CopyClassInput,
  ): Promise<lifecycle.CopyClassOutput> {
    return this.invoke("copyClass", input);
  }

  moveClass(
    input: lifecycle.MoveClassInput,
  ): Promise<lifecycle.MoveClassOutput> {
    return this.invoke("moveClass", input);
  }

  moveClassToTop(
    input: lifecycle.MoveClassToTopInput,
  ): Promise<lifecycle.MoveClassToTopOutput> {
    return this.invoke("moveClassToTop", input);
  }

  moveClassToBottom(
    input: lifecycle.MoveClassToBottomInput,
  ): Promise<lifecycle.MoveClassToBottomOutput> {
    return this.invoke("moveClassToBottom", input);
  }

  getSourceFile(
    input: lifecycle.GetSourceFileInput,
  ): Promise<lifecycle.GetSourceFileOutput> {
    return this.invoke("getSourceFile", input);
  }

  setSourceFile(
    input: lifecycle.SetSourceFileInput,
  ): Promise<lifecycle.SetSourceFileOutput> {
    return this.invoke("setSourceFile", input);
  }

  diffModelicaFileListings(
    input: lifecycle.DiffModelicaFileListingsInput,
  ): Promise<lifecycle.DiffModelicaFileListingsOutput> {
    return this.invoke("diffModelicaFileListings", input);
  }

  save(input: lifecycle.SaveInput): Promise<lifecycle.SaveOutput> {
    return this.invoke("save", input);
  }

  cd(input: lifecycle.CdInput = {}): Promise<lifecycle.CdOutput> {
    return lifecycle.cd(this, input);
  }

  loadClassContentString(
    input: lifecycle.LoadClassContentStringInput,
  ): Promise<lifecycle.LoadClassContentStringOutput> {
    return this.invoke("loadClassContentString", input);
  }

  // === Parameters & modifiers ==========================================

  getParameterValue(
    input: parameters.GetParameterValueInput,
  ): Promise<parameters.GetParameterValueOutput> {
    return this.invoke("getParameterValue", input);
  }

  getComponentModifierNames(
    input: parameters.GetComponentModifierNamesInput,
  ): Promise<parameters.GetComponentModifierNamesOutput> {
    return this.invoke("getComponentModifierNames", input);
  }

  getComponentModifierValue(
    input: parameters.GetComponentModifierValueInput,
  ): Promise<parameters.GetComponentModifierValueOutput> {
    return this.invoke("getComponentModifierValue", input);
  }

  getComponentModifierValues(
    input: parameters.GetComponentModifierValuesInput,
  ): Promise<parameters.GetComponentModifierValuesOutput> {
    return this.invoke("getComponentModifierValues", input);
  }

  setComponentModifierValue(
    input: parameters.SetComponentModifierValueInput,
  ): Promise<parameters.SetComponentModifierValueOutput> {
    return this.invoke("setComponentModifierValue", input);
  }

  removeComponentModifiers(
    input: parameters.RemoveComponentModifiersInput,
  ): Promise<parameters.RemoveComponentModifiersOutput> {
    return this.invoke("removeComponentModifiers", input);
  }

  getExtendsModifierNames(
    input: parameters.GetExtendsModifierNamesInput,
  ): Promise<parameters.GetExtendsModifierNamesOutput> {
    return this.invoke("getExtendsModifierNames", input);
  }

  getExtendsModifierValue(
    input: parameters.GetExtendsModifierValueInput,
  ): Promise<parameters.GetExtendsModifierValueOutput> {
    return this.invoke("getExtendsModifierValue", input);
  }

  setExtendsModifierValue(
    input: parameters.SetExtendsModifierValueInput,
  ): Promise<parameters.SetExtendsModifierValueOutput> {
    return this.invoke("setExtendsModifierValue", input);
  }

  getParameterNames(
    input: parameters.GetParameterNamesInput,
  ): Promise<parameters.GetParameterNamesOutput> {
    return this.invoke("getParameterNames", input);
  }

  setParameterValue(
    input: parameters.SetParameterValueInput,
  ): Promise<parameters.SetParameterValueOutput> {
    return this.invoke("setParameterValue", input);
  }

  removeExtendsModifiers(
    input: parameters.RemoveExtendsModifiersInput,
  ): Promise<parameters.RemoveExtendsModifiersOutput> {
    return this.invoke("removeExtendsModifiers", input);
  }

  getDerivedClassModifierNames(
    input: parameters.GetDerivedClassModifierNamesInput,
  ): Promise<parameters.GetDerivedClassModifierNamesOutput> {
    return this.invoke("getDerivedClassModifierNames", input);
  }

  getDerivedClassModifierValue(
    input: parameters.GetDerivedClassModifierValueInput,
  ): Promise<parameters.GetDerivedClassModifierValueOutput> {
    return this.invoke("getDerivedClassModifierValue", input);
  }

  isExtendsModifierFinal(
    input: parameters.IsExtendsModifierFinalInput,
  ): Promise<parameters.IsExtendsModifierFinalOutput> {
    return this.invoke("isExtendsModifierFinal", input);
  }

  setExtendsModifier(
    input: parameters.SetExtendsModifierInput,
  ): Promise<parameters.SetExtendsModifierOutput> {
    return this.invoke("setExtendsModifier", input);
  }

  // === Elements ========================================================

  getElements(
    input: elements.GetElementsInput,
  ): Promise<elements.GetElementsOutput> {
    return this.invoke("getElements", input);
  }

  getElementsInfo(
    input: elements.GetElementsInfoInput,
  ): Promise<elements.GetElementsInfoOutput> {
    return this.invoke("getElementsInfo", input);
  }

  getElementAnnotation(
    input: elements.GetElementAnnotationInput,
  ): Promise<elements.GetElementAnnotationOutput> {
    return this.invoke("getElementAnnotation", input);
  }

  getElementAnnotations(
    input: elements.GetElementAnnotationsInput,
  ): Promise<elements.GetElementAnnotationsOutput> {
    return this.invoke("getElementAnnotations", input);
  }

  getElementModifierNames(
    input: elements.GetElementModifierNamesInput,
  ): Promise<elements.GetElementModifierNamesOutput> {
    return this.invoke("getElementModifierNames", input);
  }

  getElementModifierValue(
    input: elements.GetElementModifierValueInput,
  ): Promise<elements.GetElementModifierValueOutput> {
    return this.invoke("getElementModifierValue", input);
  }

  getElementModifierValues(
    input: elements.GetElementModifierValuesInput,
  ): Promise<elements.GetElementModifierValuesOutput> {
    return this.invoke("getElementModifierValues", input);
  }

  setElementModifierValue(
    input: elements.SetElementModifierValueInput,
  ): Promise<elements.SetElementModifierValueOutput> {
    return this.invoke("setElementModifierValue", input);
  }

  setElementAnnotation(
    input: elements.SetElementAnnotationInput,
  ): Promise<elements.SetElementAnnotationOutput> {
    return this.invoke("setElementAnnotation", input);
  }

  setElementType(
    input: elements.SetElementTypeInput,
  ): Promise<elements.SetElementTypeOutput> {
    return this.invoke("setElementType", input);
  }

  removeElementModifiers(
    input: elements.RemoveElementModifiersInput,
  ): Promise<elements.RemoveElementModifiersOutput> {
    return this.invoke("removeElementModifiers", input);
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
    return this.invoke("getAvailableLibraryVersions", input);
  }

  getAvailablePackageVersions(
    input: library.GetAvailablePackageVersionsInput,
  ): Promise<library.GetAvailablePackageVersionsOutput> {
    return this.invoke("getAvailablePackageVersions", input);
  }

  getAvailablePackageConversionsFrom(
    input: library.GetAvailablePackageConversionsFromInput,
  ): Promise<library.GetAvailablePackageConversionsFromOutput> {
    return this.invoke("getAvailablePackageConversionsFrom", input);
  }

  getAvailablePackageConversionsTo(
    input: library.GetAvailablePackageConversionsToInput,
  ): Promise<library.GetAvailablePackageConversionsToOutput> {
    return this.invoke("getAvailablePackageConversionsTo", input);
  }

  getConversionsFromVersions(
    input: library.GetConversionsFromVersionsInput,
  ): Promise<library.GetConversionsFromVersionsOutput> {
    return this.invoke("getConversionsFromVersions", input);
  }

  installPackage(
    input: library.InstallPackageInput,
  ): Promise<library.InstallPackageOutput> {
    return this.invoke("installPackage", input);
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

  loadFiles(input: library.LoadFilesInput): Promise<library.LoadFilesOutput> {
    return this.invoke("loadFiles", input);
  }

  // === Solver / runtime config =========================================

  setMatchingAlgorithm(
    input: solver.SetMatchingAlgorithmInput,
  ): Promise<solver.SetMatchingAlgorithmOutput> {
    return this.invoke("setMatchingAlgorithm", input);
  }

  setIndexReductionMethod(
    input: solver.SetIndexReductionMethodInput,
  ): Promise<solver.SetIndexReductionMethodOutput> {
    return this.invoke("setIndexReductionMethod", input);
  }

  setCommandLineOptions(
    input: solver.SetCommandLineOptionsInput,
  ): Promise<solver.SetCommandLineOptionsOutput> {
    return this.invoke("setCommandLineOptions", input);
  }

  getMatchingAlgorithm(
    input: solver.GetMatchingAlgorithmInput = {},
  ): Promise<solver.GetMatchingAlgorithmOutput> {
    return solver.getMatchingAlgorithm(this, input);
  }

  getAvailableMatchingAlgorithms(
    input: solver.GetAvailableMatchingAlgorithmsInput = {},
  ): Promise<solver.GetAvailableMatchingAlgorithmsOutput> {
    return solver.getAvailableMatchingAlgorithms(this, input);
  }

  getIndexReductionMethod(
    input: solver.GetIndexReductionMethodInput = {},
  ): Promise<solver.GetIndexReductionMethodOutput> {
    return solver.getIndexReductionMethod(this, input);
  }

  getAvailableIndexReductionMethods(
    input: solver.GetAvailableIndexReductionMethodsInput = {},
  ): Promise<solver.GetAvailableIndexReductionMethodsOutput> {
    return solver.getAvailableIndexReductionMethods(this, input);
  }

  getAvailableTearingMethods(
    input: solver.GetAvailableTearingMethodsInput = {},
  ): Promise<solver.GetAvailableTearingMethodsOutput> {
    return solver.getAvailableTearingMethods(this, input);
  }

  // === Editing =========================================================

  addComponent(
    input: editing.AddComponentInput,
  ): Promise<editing.AddComponentOutput> {
    return this.invoke("addComponent", input);
  }

  deleteComponent(
    input: editing.DeleteComponentInput,
  ): Promise<editing.DeleteComponentOutput> {
    return this.invoke("deleteComponent", input);
  }

  renameComponent(
    input: editing.RenameComponentInput,
  ): Promise<editing.RenameComponentOutput> {
    return this.invoke("renameComponent", input);
  }

  updateComponent(
    input: editing.UpdateComponentInput,
  ): Promise<editing.UpdateComponentOutput> {
    return this.invoke("updateComponent", input);
  }

  addConnection(
    input: editing.AddConnectionInput,
  ): Promise<editing.AddConnectionOutput> {
    return this.invoke("addConnection", input);
  }

  deleteConnection(
    input: editing.DeleteConnectionInput,
  ): Promise<editing.DeleteConnectionOutput> {
    return this.invoke("deleteConnection", input);
  }

  updateConnection(
    input: editing.UpdateConnectionInput,
  ): Promise<editing.UpdateConnectionOutput> {
    return this.invoke("updateConnection", input);
  }

  updateConnectionNames(
    input: editing.UpdateConnectionNamesInput,
  ): Promise<editing.UpdateConnectionNamesOutput> {
    return this.invoke("updateConnectionNames", input);
  }

  addTransition(
    input: editing.AddTransitionInput,
  ): Promise<editing.AddTransitionOutput> {
    return this.invoke("addTransition", input);
  }

  deleteTransition(
    input: editing.DeleteTransitionInput,
  ): Promise<editing.DeleteTransitionOutput> {
    return this.invoke("deleteTransition", input);
  }

  updateTransition(
    input: editing.UpdateTransitionInput,
  ): Promise<editing.UpdateTransitionOutput> {
    return this.invoke("updateTransition", input);
  }

  addClassAnnotation(
    input: editing.AddClassAnnotationInput,
  ): Promise<editing.AddClassAnnotationOutput> {
    return this.invoke("addClassAnnotation", input);
  }

  writeClassGraphics(
    input: editing.WriteClassGraphicsInput,
  ): Promise<editing.WriteClassGraphicsOutput> {
    return this.invoke("writeClassGraphics", input);
  }

  setComponentProperties(
    input: editing.SetComponentPropertiesInput,
  ): Promise<editing.SetComponentPropertiesOutput> {
    return this.invoke("setComponentProperties", input);
  }

  setComponentDimensions(
    input: editing.SetComponentDimensionsInput,
  ): Promise<editing.SetComponentDimensionsOutput> {
    return this.invoke("setComponentDimensions", input);
  }

  setComponentComment(
    input: editing.SetComponentCommentInput,
  ): Promise<editing.SetComponentCommentOutput> {
    return this.invoke("setComponentComment", input);
  }

  setClassComment(
    input: editing.SetClassCommentInput,
  ): Promise<editing.SetClassCommentOutput> {
    return this.invoke("setClassComment", input);
  }

  setDocumentationAnnotation(
    input: editing.SetDocumentationAnnotationInput,
  ): Promise<editing.SetDocumentationAnnotationOutput> {
    return this.invoke("setDocumentationAnnotation", input);
  }

  setFullDocumentationAnnotation(
    input: editing.SetFullDocumentationAnnotationInput,
  ): Promise<editing.SetFullDocumentationAnnotationOutput> {
    return this.invoke("setFullDocumentationAnnotation", input);
  }

  addInitialState(
    input: editing.AddInitialStateInput,
  ): Promise<editing.AddInitialStateOutput> {
    return this.invoke("addInitialState", input);
  }

  deleteInitialState(
    input: editing.DeleteInitialStateInput,
  ): Promise<editing.DeleteInitialStateOutput> {
    return this.invoke("deleteInitialState", input);
  }

  updateInitialState(
    input: editing.UpdateInitialStateInput,
  ): Promise<editing.UpdateInitialStateOutput> {
    return this.invoke("updateInitialState", input);
  }

  renameComponentInClass(
    input: editing.RenameComponentInClassInput,
  ): Promise<editing.RenameComponentInClassOutput> {
    return this.invoke("renameComponentInClass", input);
  }

  // === Execution =======================================================

  checkModel(
    input: execution.CheckModelInput,
  ): Promise<execution.CheckModelOutput> {
    return this.invoke("checkModel", input);
  }

  translateModel(
    input: execution.TranslateModelInput,
  ): Promise<execution.TranslateModelOutput> {
    return this.invoke("translateModel", input);
  }

  buildModel(
    input: execution.BuildModelInput,
  ): Promise<execution.BuildModelOutput> {
    return this.invoke("buildModel", input);
  }

  simulate(input: execution.SimulateInput): Promise<execution.SimulateOutput> {
    return this.invoke("simulate", input);
  }

  buildModelFMU(
    input: execution.BuildModelFMUInput,
  ): Promise<execution.BuildModelFMUOutput> {
    return this.invoke("buildModelFMU", input);
  }

  translateModelXML(
    input: execution.TranslateModelXMLInput,
  ): Promise<execution.TranslateModelXMLOutput> {
    return this.invoke("translateModelXML", input);
  }

  importFMU(
    input: execution.ImportFMUInput,
  ): Promise<execution.ImportFMUOutput> {
    return this.invoke("importFMU", input);
  }

  getSimulationOptions(
    input: execution.GetSimulationOptionsInput,
  ): Promise<execution.GetSimulationOptionsOutput> {
    return this.invoke("getSimulationOptions", input);
  }

  isExperiment(
    input: execution.IsExperimentInput,
  ): Promise<execution.IsExperimentOutput> {
    return this.invoke("isExperiment", input);
  }

  // === Results =========================================================

  readSimulationResultSize(
    input: results.ReadSimulationResultSizeInput,
  ): Promise<results.ReadSimulationResultSizeOutput> {
    return this.invoke("readSimulationResultSize", input);
  }

  readSimulationResultVars(
    input: results.ReadSimulationResultVarsInput,
  ): Promise<results.ReadSimulationResultVarsOutput> {
    return this.invoke("readSimulationResultVars", input);
  }

  closeSimulationResultFile(
    input: results.CloseSimulationResultFileInput = {},
  ): Promise<results.CloseSimulationResultFileOutput> {
    return results.closeSimulationResultFile(this, input);
  }

  readSimulationResult(
    input: results.ReadSimulationResultInput,
  ): Promise<results.ReadSimulationResultOutput> {
    return this.invoke("readSimulationResult", input);
  }

  val(input: results.ValInput): Promise<results.ValOutput> {
    return this.invoke("val", input);
  }

  filterSimulationResults(
    input: results.FilterSimulationResultsInput,
  ): Promise<results.FilterSimulationResultsOutput> {
    return this.invoke("filterSimulationResults", input);
  }

  deltaSimulationResults(
    input: results.DeltaSimulationResultsInput,
  ): Promise<results.DeltaSimulationResultsOutput> {
    return this.invoke("deltaSimulationResults", input);
  }

  diffSimulationResults(
    input: results.DiffSimulationResultsInput,
  ): Promise<results.DiffSimulationResultsOutput> {
    return this.invoke("diffSimulationResults", input);
  }
}
