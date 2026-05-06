/**
 * Typed client for OMC's interactive ZMQ API.
 *
 * Single OMC subprocess + REQ socket per OmcClient instance. OMC is
 * single-threaded, so all calls serialize through a promise-chain mutex.
 *
 * For long calls (translate/build/simulate) bump the call timeout via
 * `setCallTimeout` or pass a per-call override into `call`.
 */

import type { OmcCommand } from "./commands.js";
import { spawnOmc, type OmcProcess } from "./process.js";
import { OmcTransport } from "./transport.js";
import {
  asBool,
  asFloat,
  asInt,
  asString,
  expectBool,
  expectInt,
  expectList,
  expectString,
  expectStringList,
  isNull,
  parse,
  type Value,
} from "./parse.js";
import type {
  ClassInformation,
  ComponentInfo,
  Connection,
  LibraryUse,
  SimulationOptions,
  SimulationResult,
} from "./types.js";

const DEFAULT_CALL_TIMEOUT_MS = 60_000;

export interface OmcClientOptions {
  /** Path to omc binary. Empty/undefined uses "omc" from PATH. */
  omcPath?: string;
  /** Per-call timeout in ms (default 60_000). Pass 0 to disable. */
  callTimeoutMs?: number;
}

export class OmcClient {
  private constructor(
    private readonly proc: OmcProcess,
    private readonly transport: OmcTransport,
    private callTimeoutMs: number,
  ) {}

  /** Promise-chain mutex: every call awaits the previous before issuing. */
  private chain: Promise<unknown> = Promise.resolve();
  private closed = false;

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
   * Send a raw Modelica command string and return OMC's raw response.
   * Serializes against any other in-flight call.
   *
   * `cmd` is constrained to `${OmcFunction}(${string})` — see commands.ts for
   * the whitelist. To send something genuinely off-list, cast: `cmd as OmcCommand`.
   */
  async call(cmd: OmcCommand): Promise<string> {
    if (this.closed) throw new Error("omc client closed");
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
   * Fetch and clear OMC's accumulated error buffer. Many OMC calls return
   * false/empty on failure and stash the diagnostic here; check this if a
   * call's result looks like a benign falsy answer but the action should
   * have succeeded.
   */
  async getErrorString(): Promise<string> {
    const raw = await this.call("getErrorString()");
    return raw.trim();
  }

  /**
   * Best-effort clean shutdown: send `quit()`, close socket, kill subprocess.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      // Best effort: short timeout so a hung OMC doesn't block shutdown.
      await this.transport.send("quit()", 2_000);
    } catch {
      /* ignore */
    }
    await this.transport.close();
    await this.proc.stop();
  }

  // --- internal helpers -------------------------------------------------

  private async callValue(cmd: OmcCommand): Promise<Value> {
    const raw = await this.call(cmd);
    return parse(raw);
  }

  /**
   * Run a command expected to return bool. On `false`, fetches getErrorString()
   * and surfaces it as an Error if non-empty.
   */
  private async callBool(cmd: OmcCommand): Promise<boolean> {
    const v = await this.callValue(cmd);
    const b = expectBool(v);
    if (!b) {
      const errs = await this.getErrorString();
      if (errs.length > 0) {
        const head = cmd.split("(", 1)[0] ?? cmd;
        throw new Error(`${head}: ${errs}`);
      }
    }
    return b;
  }

  // === Browsing ========================================================

  async getVersion(): Promise<string> {
    return expectString(await this.callValue("getVersion()"));
  }

  /** Lists subclasses of `clazz`; pass "" for top-level packages. */
  async getClassNames(clazz: string, recursive = false): Promise<string[]> {
    const cmd: OmcCommand =
      clazz === ""
        ? `getClassNames(recursive=${mlBool(recursive)})`
        : `getClassNames(${clazz}, recursive=${mlBool(recursive)})`;
    return expectStringList(await this.callValue(cmd));
  }

  async searchClassNames(query: string, findInText = false): Promise<string[]> {
    return expectStringList(
      await this.callValue(
        `searchClassNames(${quote(query)}, findInText=${mlBool(findInText)})`,
      ),
    );
  }

  async getClassInformation(clazz: string): Promise<ClassInformation> {
    const v = await this.callValue(`getClassInformation(${clazz})`);
    const items = expectList(v);
    if (items.length < 22) {
      throw new Error(`getClassInformation: got ${items.length} fields, want >=22`);
    }
    const at = (i: number): Value => items[i] as Value;
    const str = (i: number): string => asString(at(i)) ?? "";
    const bl = (i: number): boolean => asBool(at(i)) ?? false;
    const num = (i: number): number => asInt(at(i)) ?? 0;
    const dimsRaw = at(11);
    const dims =
      dimsRaw.kind === "list"
        ? dimsRaw.items.map((d) => asString(d) ?? "")
        : [];
    return {
      restriction: str(0),
      comment: str(1),
      partialPrefix: bl(2),
      finalPrefix: bl(3),
      encapsulatedPrefix: bl(4),
      fileName: str(5),
      fileReadOnly: bl(6),
      lineStart: num(7),
      columnStart: num(8),
      lineEnd: num(9),
      columnEnd: num(10),
      dimensions: dims,
      isProtectedClass: bl(12),
      isDocumentationClass: bl(13),
      version: str(14),
      preferredView: str(15),
      isState: bl(16),
      access: str(17),
      versionDate: str(18),
      versionBuild: str(19),
      dateModified: str(20),
      revisionId: str(21),
    };
  }

  async isPackage(clazz: string): Promise<boolean> {
    return expectBool(await this.callValue(`isPackage(${clazz})`));
  }

  async getInheritanceCount(clazz: string): Promise<number> {
    return expectInt(await this.callValue(`getInheritanceCount(${clazz})`));
  }

  async getInheritedClasses(clazz: string): Promise<string[]> {
    return expectStringList(await this.callValue(`getInheritedClasses(${clazz})`));
  }

  async getUses(clazz: string): Promise<LibraryUse[]> {
    const v = await this.callValue(`getUses(${clazz})`);
    const rows = expectList(v);
    return rows.map((row) => {
      const pair = expectStringList(row);
      if (pair.length < 2) {
        throw new Error(`getUses: malformed pair: ${JSON.stringify(pair)}`);
      }
      return [pair[0] ?? "", pair[1] ?? ""];
    });
  }

  async existClass(clazz: string): Promise<boolean> {
    return expectBool(await this.callValue(`existClass(${clazz})`));
  }

  // === Reading model contents ==========================================

  async getComponents(clazz: string): Promise<ComponentInfo[]> {
    const v = await this.callValue(`getComponents(${clazz})`);
    const rows = expectList(v);
    return rows.map((row, idx) => {
      const fields = expectList(row);
      if (fields.length < 12) {
        throw new Error(
          `getComponents row ${idx}: got ${fields.length} fields, want >=12`,
        );
      }
      const at = (i: number): Value => fields[i] as Value;
      const str = (i: number): string => asString(at(i)) ?? "";
      const bl = (i: number): boolean => asBool(at(i)) ?? false;
      const dimsRaw = at(11);
      const dims =
        dimsRaw.kind === "list"
          ? dimsRaw.items.map((d) => asString(d) ?? "")
          : [];
      return {
        className: str(0),
        name: str(1),
        comment: str(2),
        protection: str(3),
        isFinal: bl(4),
        isFlow: bl(5),
        isStream: bl(6),
        isReplaceable: bl(7),
        variability: str(8),
        innerOuter: str(9),
        causality: str(10),
        dimensions: dims,
      };
    });
  }

  /**
   * Returns each component's annotation as a parsed Value (typically
   * `Placement(transformation=Transformation(...))`). Downstream consumers
   * (annotations parser, JSON marshal) work directly with the Value tree.
   */
  async getComponentAnnotations(clazz: string): Promise<Value[]> {
    const v = await this.callValue(`getComponentAnnotations(${clazz})`);
    return expectList(v);
  }

  async getConnectionCount(clazz: string): Promise<number> {
    return expectInt(await this.callValue(`getConnectionCount(${clazz})`));
  }

  async getNthConnection(clazz: string, n: number): Promise<Connection> {
    const v = await this.callValue(`getNthConnection(${clazz}, ${n})`);
    const fields = expectStringList(v);
    if (fields.length < 2) {
      throw new Error(`getNthConnection: got ${fields.length} fields, want >=2`);
    }
    return {
      from: fields[0] ?? "",
      to: fields[1] ?? "",
      comment: fields[2] ?? "",
    };
  }

  async getNthConnectionAnnotation(clazz: string, n: number): Promise<Value> {
    return this.callValue(`getNthConnectionAnnotation(${clazz}, ${n})`);
  }

  async getTransitions(clazz: string): Promise<string[][]> {
    const v = await this.callValue(`getTransitions(${clazz})`);
    return expectList(v).map((row) => expectStringList(row));
  }

  async getInitialStates(clazz: string): Promise<string[][]> {
    const v = await this.callValue(`getInitialStates(${clazz})`);
    return expectList(v).map((row) => expectStringList(row));
  }

  /**
   * Returns the parsed icon-layer annotation Value. Top-level shape (per OMC):
   *
   *     {x1, y1, x2, y2, gridVisible, gridX, gridY, initialScale,
   *      {shape1, shape2, ...}}
   */
  async getIconAnnotation(clazz: string): Promise<Value> {
    return this.callValue(`getIconAnnotation(${clazz})`);
  }

  async getDiagramAnnotation(clazz: string): Promise<Value> {
    return this.callValue(`getDiagramAnnotation(${clazz})`);
  }

  /** Returns {info, revisions, infoHeader} HTML strings. */
  async getDocumentationAnnotation(clazz: string): Promise<string[]> {
    return expectStringList(await this.callValue(`getDocumentationAnnotation(${clazz})`));
  }

  async listFile(clazz: string): Promise<string> {
    return expectString(await this.callValue(`listFile(${clazz})`));
  }

  async instantiateModel(clazz: string): Promise<string> {
    return expectString(await this.callValue(`instantiateModel(${clazz})`));
  }

  // === Lifecycle =======================================================

  async loadFile(
    path: string,
    encoding = "",
    uses = true,
    requireExactVersion = false,
  ): Promise<boolean> {
    return this.callBool(
      `loadFile(${quote(path)}, ${quote(encoding)}, uses=${mlBool(uses)}, notify=true, requireExactVersion=${mlBool(requireExactVersion)})`,
    );
  }

  async loadString(
    source: string,
    fileName: string,
    encoding = "",
    mergeAST = false,
  ): Promise<boolean> {
    return this.callBool(
      `loadString(${quote(source)}, ${quote(fileName)}, ${quote(encoding)}, mergeAST=${mlBool(mergeAST)})`,
    );
  }

  async loadModel(
    name: string,
    versions: string[] = [],
    notify = false,
    requireExactVersion = false,
  ): Promise<boolean> {
    const versionsArg =
      versions.length === 0 ? `{"default"}` : quoteList(versions);
    return this.callBool(
      `loadModel(${name}, ${versionsArg}, ${mlBool(notify)}, "", ${mlBool(requireExactVersion)})`,
    );
  }

  async parseFile(path: string, encoding = ""): Promise<string[]> {
    const v = await this.callValue(`parseFile(${quote(path)}, ${quote(encoding)})`);
    return expectStringList(v);
  }

  async createClass(
    clazz: string,
    restriction: string,
    partial = false,
    encapsulated = false,
  ): Promise<boolean> {
    return this.callBool(
      `createClass(${clazz}, ${quote(restriction)}, ${mlBool(partial)}, ${mlBool(encapsulated)})`,
    );
  }

  async createSubClass(
    clazz: string,
    parent: string,
    restriction: string,
    partial = false,
    encapsulated = false,
  ): Promise<boolean> {
    return this.callBool(
      `createSubClass(${clazz}, ${parent}, ${quote(restriction)}, ${mlBool(partial)}, ${mlBool(encapsulated)})`,
    );
  }

  async renameClass(clazz: string, newName: string): Promise<string> {
    return expectString(await this.callValue(`renameClass(${clazz}, ${newName})`));
  }

  async deleteClass(clazz: string): Promise<boolean> {
    return this.callBool(`deleteClass(${clazz})`);
  }

  async copyClass(source: string, dest: string, within = ""): Promise<boolean> {
    const cmd: OmcCommand =
      within === ""
        ? `copyClass(${source}, ${dest})`
        : `copyClass(${source}, ${dest}, ${within})`;
    return this.callBool(cmd);
  }

  async moveClass(clazz: string, newParent: string): Promise<boolean> {
    return this.callBool(`moveClass(${clazz}, ${newParent})`);
  }

  async moveClassToTop(clazz: string): Promise<boolean> {
    return this.callBool(`moveClassToTop(${clazz})`);
  }

  async moveClassToBottom(clazz: string): Promise<boolean> {
    return this.callBool(`moveClassToBottom(${clazz})`);
  }

  async getSourceFile(clazz: string): Promise<string> {
    return expectString(await this.callValue(`getSourceFile(${clazz})`));
  }

  /** Used after Option-B saves: tells OMC where the file now lives. */
  async setSourceFile(clazz: string, path: string): Promise<boolean> {
    return this.callBool(`setSourceFile(${clazz}, ${quote(path)})`);
  }

  /** kind = "plain" | "color". */
  async diffModelicaFileListings(
    before: string,
    after: string,
    kind: "plain" | "color",
  ): Promise<string> {
    return expectString(
      await this.callValue(
        `diffModelicaFileListings(${quote(before)}, ${quote(after)}, OpenModelica.Scripting.DiffFormat.${kind})`,
      ),
    );
  }

  /**
   * OMEdit-deprecated; we use Option B (listFile + own writer) for production
   * paths. Provided for completeness.
   */
  async save(clazz: string): Promise<boolean> {
    return this.callBool(`save(${clazz})`);
  }

  // === Parameters & modifiers ==========================================

  async getParameterValue(clazz: string, name: string): Promise<string> {
    const v = await this.callValue(`getParameterValue(${clazz}, ${name})`);
    if (isNull(v)) return "";
    const s = asString(v);
    if (s !== undefined) return s;
    return String(asFloat(v) ?? asInt(v) ?? asBool(v) ?? "");
  }

  async getComponentModifierNames(clazz: string, component: string): Promise<string[]> {
    return expectStringList(
      await this.callValue(`getComponentModifierNames(${clazz}, ${component})`),
    );
  }

  async getComponentModifierValue(clazz: string, modifier: string): Promise<string> {
    const v = await this.callValue(`getComponentModifierValue(${clazz}, ${modifier})`);
    return asString(v) ?? "";
  }

  async getComponentModifierValues(clazz: string, modifier: string): Promise<string> {
    const v = await this.callValue(`getComponentModifierValues(${clazz}, ${modifier})`);
    return asString(v) ?? "";
  }

  /**
   * Set a modifier on a component.
   * `expr` is the raw Modelica expression for the value (e.g. `1.5`,
   * `true`, `{1, 2, 3}`); empty string removes the modifier.
   */
  async setComponentModifierValue(
    clazz: string,
    modifier: string,
    expr: string,
  ): Promise<boolean> {
    const codeArg = expr === "" ? "$Code(=)" : `$Code(=${expr})`;
    return this.callBool(
      `setComponentModifierValue(${clazz}, ${modifier}, ${codeArg})`,
    );
  }

  async removeComponentModifiers(
    clazz: string,
    component: string,
    keepRedeclares = false,
  ): Promise<boolean> {
    return this.callBool(
      `removeComponentModifiers(${clazz}, ${component}, ${mlBool(keepRedeclares)})`,
    );
  }

  async getExtendsModifierNames(
    clazz: string,
    extendsBase: string,
    useQuotes = false,
  ): Promise<string[]> {
    return expectStringList(
      await this.callValue(
        `getExtendsModifierNames(${clazz}, ${extendsBase}, useQuotes=${mlBool(useQuotes)})`,
      ),
    );
  }

  async getExtendsModifierValue(
    clazz: string,
    extendsBase: string,
    modifier: string,
  ): Promise<string> {
    const v = await this.callValue(
      `getExtendsModifierValue(${clazz}, ${extendsBase}, ${modifier})`,
    );
    return asString(v) ?? "";
  }

  async setExtendsModifierValue(
    clazz: string,
    extendsBase: string,
    modifier: string,
    expr: string,
  ): Promise<boolean> {
    const codeArg = expr === "" ? "$Code(=)" : `$Code(=${expr})`;
    return this.callBool(
      `setExtendsModifierValue(${clazz}, ${extendsBase}, ${modifier}, ${codeArg})`,
    );
  }

  // === Editing =========================================================

  async addComponent(
    name: string,
    componentClass: string,
    into: string,
    annotation = "",
  ): Promise<boolean> {
    const ann = annotation === "" ? "annotate=Placement()" : `annotate=${annotation}`;
    return this.callBool(
      `addComponent(${name}, ${componentClass}, ${into}, ${ann})`,
    );
  }

  async deleteComponent(name: string, clazz: string): Promise<boolean> {
    return this.callBool(`deleteComponent(${name}, ${clazz})`);
  }

  async renameComponent(
    clazz: string,
    oldName: string,
    newName: string,
  ): Promise<string[]> {
    return expectStringList(
      await this.callValue(`renameComponent(${clazz}, ${oldName}, ${newName})`),
    );
  }

  async updateComponent(
    name: string,
    componentClass: string,
    into: string,
    annotation = "",
  ): Promise<boolean> {
    const ann = annotation === "" ? "annotate=Placement()" : `annotate=${annotation}`;
    return this.callBool(
      `updateComponent(${name}, ${componentClass}, ${into}, ${ann})`,
    );
  }

  async addConnection(
    from: string,
    to: string,
    clazz: string,
    annotation = "",
  ): Promise<boolean> {
    const ann = annotation === "" ? "annotate=Line()" : `annotate=${annotation}`;
    return this.callBool(`addConnection(${from}, ${to}, ${clazz}, ${ann})`);
  }

  async deleteConnection(from: string, to: string, clazz: string): Promise<boolean> {
    return this.callBool(`deleteConnection(${from}, ${to}, ${clazz})`);
  }

  async updateConnection(
    from: string,
    to: string,
    clazz: string,
    annotation = "",
  ): Promise<boolean> {
    const ann = annotation === "" ? "annotate=Line()" : `annotate=${annotation}`;
    return this.callBool(`updateConnection(${from}, ${to}, ${clazz}, ${ann})`);
  }

  async addTransition(
    clazz: string,
    from: string,
    to: string,
    condition: string,
    immediate: boolean,
    reset: boolean,
    synchronize: boolean,
    priority: number,
    annotation = "",
  ): Promise<boolean> {
    const ann = annotation === "" ? "annotate=Line()" : `annotate=${annotation}`;
    return this.callBool(
      `addTransition(${clazz}, ${from}, ${to}, ${quote(condition)}, ${mlBool(immediate)}, ${mlBool(reset)}, ${mlBool(synchronize)}, ${priority}, ${ann})`,
    );
  }

  async deleteTransition(
    clazz: string,
    from: string,
    to: string,
    condition: string,
    immediate: boolean,
    reset: boolean,
    synchronize: boolean,
    priority: number,
  ): Promise<boolean> {
    return this.callBool(
      `deleteTransition(${clazz}, ${from}, ${to}, ${quote(condition)}, ${mlBool(immediate)}, ${mlBool(reset)}, ${mlBool(synchronize)}, ${priority})`,
    );
  }

  async addClassAnnotation(clazz: string, annotation: string): Promise<boolean> {
    return this.callBool(`addClassAnnotation(${clazz}, ${annotation})`);
  }

  async setComponentProperties(
    clazz: string,
    name: string,
    finalPrefix: boolean,
    flow: boolean,
    stream: boolean,
    replaceablePrefix: boolean,
    variability: string,
    causality: string,
    innerOuter: string,
  ): Promise<boolean> {
    return this.callBool(
      `setComponentProperties(${clazz}, ${name}, {${mlBool(finalPrefix)},${mlBool(flow)},${mlBool(stream)},${mlBool(replaceablePrefix)}}, {${quote(variability)}, ${quote(causality)}, ${quote(innerOuter)}})`,
    );
  }

  async setComponentDimensions(
    clazz: string,
    name: string,
    dims: string[],
  ): Promise<boolean> {
    return this.callBool(
      `setComponentDimensions(${clazz}, ${name}, ${quoteList(dims)})`,
    );
  }

  async setComponentComment(
    clazz: string,
    name: string,
    comment: string,
  ): Promise<boolean> {
    return this.callBool(
      `setComponentComment(${clazz}, ${name}, ${quote(comment)})`,
    );
  }

  // === Solver / runtime config =========================================

  async getSolverMethods(): Promise<string[]> {
    return expectStringList(await this.callValue("getSolverMethods()"));
  }

  async getJacobianMethods(): Promise<string[]> {
    return expectStringList(await this.callValue("getJacobianMethods()"));
  }

  async getInitializationMethods(): Promise<string[]> {
    return expectStringList(await this.callValue("getInitializationMethods()"));
  }

  async getLinearSolvers(): Promise<string[]> {
    return expectStringList(await this.callValue("getLinearSolvers()"));
  }

  async getNonLinearSolvers(): Promise<string[]> {
    return expectStringList(await this.callValue("getNonLinearSolvers()"));
  }

  async setMatchingAlgorithm(algorithm: string): Promise<boolean> {
    return this.callBool(`setMatchingAlgorithm(${quote(algorithm)})`);
  }

  async setIndexReductionMethod(method: string): Promise<boolean> {
    return this.callBool(`setIndexReductionMethod(${quote(method)})`);
  }

  async setCommandLineOptions(options: string): Promise<boolean> {
    return this.callBool(`setCommandLineOptions(${quote(options)})`);
  }

  // === Execution =======================================================

  async checkModel(clazz: string): Promise<string> {
    return expectString(await this.callValue(`checkModel(${clazz})`));
  }

  async translateModel(clazz: string): Promise<boolean> {
    return this.callBool(`translateModel(${clazz})`);
  }

  async buildModel(clazz: string): Promise<string[]> {
    return expectStringList(await this.callValue(`buildModel(${clazz})`));
  }

  /**
   * Run translate+build+run synchronously.
   *
   * `extraOptions` is appended to the command verbatim (e.g.
   * `startTime=0, stopTime=4, tolerance=1e-6, method="dassl"`).
   *
   * NOTE: streaming progress is not yet implemented; this blocks until OMC's
   * simulate() returns. For long runs, raise the call timeout via
   * `setCallTimeout`.
   */
  async simulate(clazz: string, extraOptions = ""): Promise<SimulationResult> {
    const cmd: OmcCommand =
      extraOptions === ""
        ? `simulate(${clazz})`
        : `simulate(${clazz}, ${extraOptions})`;
    const v = await this.callValue(cmd);
    let messages = "";
    let resultFile = "";
    if (v.kind === "call") {
      messages = `${v.name}(...)`;
    } else if (v.kind === "string") {
      messages = v.value;
    }
    return { resultFile, messages };
  }

  /**
   * Export `clazz` as an FMU.
   *
   * @param version "1.0" | "2.0" | "3.0"
   * @param fmuType "me" | "cs" | "me_cs"
   * @param fileNamePrefix base name; pass "" or "<default>" to use class name
   * @param platforms e.g. ["static"], ["dynamic"], ["x86_64-linux-gnu"]
   */
  async buildModelFMU(
    clazz: string,
    version: string,
    fmuType: string,
    fileNamePrefix: string,
    platforms: string[],
    includeResources = false,
  ): Promise<string> {
    const prefix = fileNamePrefix === "" ? "<default>" : fileNamePrefix;
    const plats = platforms.length === 0 ? ["static"] : platforms;
    return expectString(
      await this.callValue(
        `buildModelFMU(${clazz}, version=${quote(version)}, fmuType=${quote(fmuType)}, fileNamePrefix=${quote(prefix)}, platforms=${quoteList(plats)}, includeResources=${mlBool(includeResources)})`,
      ),
    );
  }

  async translateModelXML(clazz: string): Promise<string> {
    return expectString(await this.callValue(`translateModelXML(${clazz})`));
  }

  async importFMU(
    fmuPath: string,
    workdir = "",
    logLevel = 0,
    fullyQualifiedName = false,
    includeResources = false,
    modelName = "",
  ): Promise<string> {
    return expectString(
      await this.callValue(
        `importFMU(${quote(fmuPath)}, ${quote(workdir)}, ${logLevel}, ${mlBool(fullyQualifiedName)}, ${mlBool(includeResources)}, ${quote(modelName)})`,
      ),
    );
  }

  async getSimulationOptions(clazz: string): Promise<SimulationOptions> {
    const v = await this.callValue(`getSimulationOptions(${clazz})`);
    const items = expectList(v);
    if (items.length < 5) {
      throw new Error(`getSimulationOptions: got ${items.length} fields, want 5`);
    }
    return {
      startTime: asFloat(items[0] as Value) ?? 0,
      stopTime: asFloat(items[1] as Value) ?? 0,
      tolerance: asFloat(items[2] as Value) ?? 0,
      numberOfIntervals: asInt(items[3] as Value) ?? 0,
      stepSize: asFloat(items[4] as Value) ?? 0,
    };
  }

  async isExperiment(clazz: string): Promise<boolean> {
    return expectBool(await this.callValue(`isExperiment(${clazz})`));
  }

  // === Results =========================================================

  async readSimulationResultSize(resultFile: string): Promise<number> {
    return expectInt(
      await this.callValue(`readSimulationResultSize(${quote(resultFile)})`),
    );
  }

  async readSimulationResultVars(
    resultFile: string,
    readParameters = true,
    openFile = true,
  ): Promise<string[]> {
    return expectStringList(
      await this.callValue(
        `readSimulationResultVars(${quote(resultFile)}, readParameters=${mlBool(readParameters)}, openmodelicaStyle=${mlBool(openFile)})`,
      ),
    );
  }

  async closeSimulationResultFile(): Promise<boolean> {
    return this.callBool("closeSimulationResultFile()");
  }
}

// --- Modelica command formatting helpers --------------------------------

/** Wrap s as a Modelica string literal, escaping the necessary characters. */
function quote(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    switch (c) {
      case '"':
        out += '\\"';
        break;
      case "\\":
        out += "\\\\";
        break;
      case "\n":
        out += "\\n";
        break;
      case "\t":
        out += "\\t";
        break;
      case "\r":
        out += "\\r";
        break;
      default:
        out += c;
    }
  }
  out += '"';
  return out;
}

/** Render a Modelica list literal of strings: `{"a", "b", "c"}`. */
function quoteList(items: string[]): string {
  if (items.length === 0) return "{}";
  return "{" + items.map(quote).join(", ") + "}";
}

function mlBool(b: boolean): string {
  return b ? "true" : "false";
}
