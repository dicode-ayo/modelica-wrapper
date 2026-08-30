/**
 * Tiny `vscode` stand-in for vitest unit tests. The real `vscode` module is
 * only available inside the extension host; for pure-logic tests we alias
 * imports of "vscode" to this file via `vitest.config.ts`.
 *
 * Only the surface area exercised by the unit tests is filled in. Add more
 * stubs here as new tests need them — keep them minimal and observable.
 */

import * as nodePath from "node:path";

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

export enum FilePermission {
  Readonly = 1,
}

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export enum FileChangeType {
  Changed = 1,
  Created = 2,
  Deleted = 3,
}

/** `FileSystemError` stand-in — carries the `code` VSCode routes on. */
export class FileSystemError extends Error {
  readonly code: string;
  private constructor(code: string, message: string) {
    super(message || code);
    this.code = code;
    this.name = "FileSystemError";
  }
  static FileNotFound(messageOrUri?: unknown): FileSystemError {
    return new FileSystemError("FileNotFound", String(messageOrUri ?? ""));
  }
  static NoPermissions(messageOrUri?: unknown): FileSystemError {
    return new FileSystemError("NoPermissions", String(messageOrUri ?? ""));
  }
  static Unavailable(messageOrUri?: unknown): FileSystemError {
    return new FileSystemError("Unavailable", String(messageOrUri ?? ""));
  }
}

/** Minimal `EventEmitter` — records listeners and fires them synchronously. */
export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  readonly event = (listener: (e: T) => void): Disposable => {
    this.listeners.push(listener);
    return new Disposable(() => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    });
  };
  fire(data: T): void {
    for (const l of this.listeners) l(data);
  }
  dispose(): void {
    this.listeners = [];
  }
}

/** Monotonic counter for untitled documents minted by `openTextDocument`. */
let untitledSeq = 0;

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}

export class Range {
  public readonly start: Position;
  public readonly end: Position;
  constructor(
    startLineOrPos: number | Position,
    startCharOrEndPos: number | Position,
    endLine?: number,
    endChar?: number,
  ) {
    if (startLineOrPos instanceof Position) {
      this.start = startLineOrPos;
      this.end = startCharOrEndPos as Position;
    } else {
      this.start = new Position(startLineOrPos, startCharOrEndPos as number);
      this.end = new Position(endLine ?? 0, endChar ?? 0);
    }
  }
}

export class Diagnostic {
  source?: string;
  code?: string | number;
  constructor(
    public range: Range,
    public message: string,
    public severity: DiagnosticSeverity = DiagnosticSeverity.Error,
  ) {}
}

export class SemanticTokensLegend {
  constructor(
    public readonly tokenTypes: string[],
    public readonly tokenModifiers: string[] = [],
  ) {}
}

export class SemanticTokens {
  constructor(
    public readonly data: Uint32Array,
    public readonly resultId?: string,
  ) {}
}

export class SemanticTokensBuilder {
  constructor(_legend?: SemanticTokensLegend) {}
  push(_range: Range, _tokenType: string): void {}
  build(): SemanticTokens {
    return new SemanticTokens(new Uint32Array());
  }
}

class UriImpl {
  private constructor(
    public readonly scheme: string,
    public readonly authority: string,
    public readonly path: string,
    public readonly query: string,
    public readonly fragment: string,
  ) {}

  static file(fsPath: string): UriImpl {
    return new UriImpl("file", "", fsPath, "", "");
  }

  static from(components: {
    scheme: string;
    authority?: string;
    path?: string;
    query?: string;
    fragment?: string;
  }): UriImpl {
    return new UriImpl(
      components.scheme,
      components.authority ?? "",
      components.path ?? "",
      components.query ?? "",
      components.fragment ?? "",
    );
  }

  static joinPath(base: UriImpl, ...segments: string[]): UriImpl {
    const joined = [base.path, ...segments].join("/").replace(/\/+/g, "/");
    return new UriImpl(base.scheme, base.authority, joined, "", "");
  }

  get fsPath(): string {
    return this.path;
  }

  static parse(value: string): UriImpl {
    // Minimal scheme://path parser sufficient for our tests; full
    // RFC-3986 handling isn't needed because callers pass simple
    // `scheme:/path` forms.
    const schemeIdx = value.indexOf(":");
    if (schemeIdx === -1) return new UriImpl("file", "", value, "", "");
    const scheme = value.slice(0, schemeIdx);
    let rest = value.slice(schemeIdx + 1);
    let authority = "";
    if (rest.startsWith("//")) {
      const end = rest.indexOf("/", 2);
      authority = end === -1 ? rest.slice(2) : rest.slice(2, end);
      rest = end === -1 ? "" : rest.slice(end);
    }
    return new UriImpl(scheme, authority, rest, "", "");
  }

  toString(): string {
    return this.authority
      ? `${this.scheme}://${this.authority}${this.path}`
      : `${this.scheme}:${this.path}`;
  }
}

export const Uri = UriImpl;
export type Uri = UriImpl;

/** `RelativePattern` stand-in — a base folder plus the glob matched against
 *  its direct children, as {@link createFileSystemWatcher} takes it. */
export class RelativePattern {
  readonly baseUri: UriImpl;
  constructor(
    base: UriImpl | string,
    public readonly pattern: string,
  ) {
    this.baseUri = typeof base === "string" ? UriImpl.file(base) : base;
  }
}

/** `TabInputText` stand-in — a text editor's tab input, carrying its `uri`. */
export class TabInputText {
  constructor(public readonly uri: UriImpl) {}
}

/** `TabInputCustom` stand-in — a custom editor's tab input (`uri` + `viewType`). */
export class TabInputCustom {
  constructor(
    public readonly uri: UriImpl,
    public readonly viewType: string,
  ) {}
}

export interface Tab {
  input: TabInputText | TabInputCustom | unknown;
  isDirty?: boolean;
}

/** A tab group the mock reports through `window.tabGroups`. */
export interface TabGroup {
  viewColumn: number;
  tabs: Tab[];
}

let tabGroupModel: TabGroup[] = [];

/** Tabs passed to `window.tabGroups.close`, flattened, for assertions. */
export const closedTabs: Tab[] = [];

/** Populate the single active tab group the mock reports (column 1). */
export function setActiveGroupTabs(tabs: Tab[]): void {
  tabGroupModel = [{ viewColumn: 1, tabs }];
}

/** Populate the full multi-column tab-group model. */
export function setTabGroups(groups: TabGroup[]): void {
  tabGroupModel = groups;
}

/** Clear the tab model between tests. */
export function resetTabs(): void {
  tabGroupModel = [];
  closedTabs.length = 0;
}

let activeTextEditorValue: { document: { uri: UriImpl } } | undefined;

/** Set (or clear) the URI the mock's `window.activeTextEditor` reports. */
export function setActiveTextEditorUri(uri: UriImpl | undefined): void {
  activeTextEditorValue = uri ? { document: { uri } } : undefined;
}

/** Minimal `WorkspaceEdit` — records whole-document replacements for assertions. */
export class WorkspaceEdit {
  readonly replacements: { uri: UriImpl; range: Range; text: string }[] = [];
  replace(uri: UriImpl, range: Range, text: string): void {
    this.replacements.push({ uri, range, text });
  }
}

/** Every `WorkspaceEdit` passed to `workspace.applyEdit`, for assertions. */
export const appliedEdits: WorkspaceEdit[] = [];

let applyEditResult = true;
let applyEditManual = false;

interface PendingApply {
  fire: () => void;
  resolve: () => void;
}

/** Applies awaiting `completeApply`, when `setApplyEditManual(true)` is set. */
export const pendingApplies: PendingApply[] = [];

/** Control the boolean `workspace.applyEdit` resolves with. */
export function setApplyEditResult(value: boolean): void {
  applyEditResult = value;
}

/**
 * When manual, `applyEdit` defers both its change event and its resolution
 * until `completeApply` — letting a test interleave two writes deterministically.
 */
export function setApplyEditManual(value: boolean): void {
  applyEditManual = value;
}

/** Fire the deferred change event and resolve the pending apply at `index`. */
export function completeApply(index = 0): void {
  const pending = pendingApplies[index];
  if (pending === undefined) return;
  pending.fire();
  pending.resolve();
}

/** Paths `workspace.findFiles` resolves with. */
let foundFiles: string[] = [];

/** Set the paths the mock's `workspace.findFiles` reports (e.g. an index seed). */
export function setFindFilesResult(paths: string[]): void {
  foundFiles = paths;
}

/**
 * Minimal `window` namespace. The message helpers record their args on a
 * module-level log so unit tests can assert which toast a code path
 * raised without standing up a real extension host. They return a
 * resolved Promise (matching VSCode's Thenable surface) since callers
 * `void`-discard the result. `createOutputChannel` returns a no-op channel
 * so the logger (used by several diagram helpers) works in unit tests
 * (issue #76, items 8/9).
 */
export interface RecordedMessage {
  level: "info" | "warning" | "error";
  message: string;
}

export const recordedMessages: RecordedMessage[] = [];

/**
 * Minimal `Disposable` — records and runs a teardown callback. Returned by the
 * `register*`/`onDid*` stubs so registration code can collect and dispose them.
 */
export class Disposable {
  static from(...disposables: { dispose(): void }[]): Disposable {
    return new Disposable(() => {
      for (const d of disposables) d.dispose();
    });
  }
  constructor(private readonly callOnDispose: () => void = () => {}) {}
  dispose(): void {
    this.callOnDispose();
  }
}

/**
 * Captured `workspace.onDid*` handlers so tests can drive editor events (save /
 * change / close) without a real extension host. Each `onDid*` records its
 * listener here and returns a {@link Disposable} that removes it.
 */
export const workspaceListeners: {
  save: Array<(document: unknown) => void>;
  change: Array<(event: unknown) => void>;
  close: Array<(document: unknown) => void>;
  configuration: Array<
    (event: { affectsConfiguration(s: string): boolean }) => void
  >;
} = { save: [], change: [], close: [], configuration: [] };

function register<T>(list: T[], listener: T): Disposable {
  list.push(listener);
  return new Disposable(() => {
    const i = list.indexOf(listener);
    if (i !== -1) list.splice(i, 1);
  });
}

/** One `createFileSystemWatcher` call: its pattern, its ignore flags, and the
 *  listeners registered on it. */
export interface WatcherRecord {
  pattern: string | RelativePattern;
  ignoreCreateEvents: boolean;
  ignoreChangeEvents: boolean;
  ignoreDeleteEvents: boolean;
  create: Array<(uri: UriImpl) => void>;
  change: Array<(uri: UriImpl) => void>;
  delete: Array<(uri: UriImpl) => void>;
  disposed: boolean;
}

/** Every watcher `createFileSystemWatcher` handed out, for assertions. */
export const fileSystemWatchers: WatcherRecord[] = [];

/** Drop recorded watchers between tests. */
export function resetFileSystemWatchers(): void {
  fileSystemWatchers.length = 0;
}

/** Match the `*`, `*.ext`, and plain-name glob forms the callers here use. */
function globMatches(glob: string, fsPath: string): boolean {
  const bare = glob.startsWith("**/") ? glob.slice(3) : glob;
  if (bare.includes("/")) return false;
  const name = nodePath.basename(fsPath);
  if (bare === "*") return true;
  return bare.startsWith("*.") ? name.endsWith(bare.slice(1)) : name === bare;
}

/** Whether a live watcher's pattern covers `fsPath`. A `RelativePattern` only
 *  covers direct children of its base; a bare glob covers any directory. */
function watcherCovers(record: WatcherRecord, fsPath: string): boolean {
  if (record.disposed) return false;
  const { pattern } = record;
  if (typeof pattern === "string") return globMatches(pattern, fsPath);
  return (
    nodePath.dirname(fsPath) === pattern.baseUri.fsPath &&
    globMatches(pattern.pattern, fsPath)
  );
}

/** Honor the ignore flags the watcher was created with, so a test that fires an
 *  ignored event sees the same nothing VSCode would deliver. */
const ignoredBy: Record<
  "create" | "change" | "delete",
  (record: WatcherRecord) => boolean
> = {
  create: (r) => r.ignoreCreateEvents,
  change: (r) => r.ignoreChangeEvents,
  delete: (r) => r.ignoreDeleteEvents,
};

function emitFileEvent(
  kind: "create" | "change" | "delete",
  fsPath: string,
): void {
  const uri = UriImpl.file(fsPath);
  for (const record of [...fileSystemWatchers]) {
    if (ignoredBy[kind](record) || !watcherCovers(record, fsPath)) continue;
    for (const listener of [...record[kind]]) listener(uri);
  }
}

/** Fire `onDidCreate` on every live watcher whose pattern covers `fsPath`. */
export function emitFileCreate(fsPath: string): void {
  emitFileEvent("create", fsPath);
}

/** Fire `onDidChange` on every live watcher whose pattern covers `fsPath`. */
export function emitFileChange(fsPath: string): void {
  emitFileEvent("change", fsPath);
}

/** Fire `onDidDelete` on every live watcher whose pattern covers `fsPath`. */
export function emitFileDelete(fsPath: string): void {
  emitFileEvent("delete", fsPath);
}

export const workspace = {
  onDidSaveTextDocument(listener: (document: unknown) => void): Disposable {
    return register(workspaceListeners.save, listener);
  },
  onDidChangeTextDocument(listener: (event: unknown) => void): Disposable {
    return register(workspaceListeners.change, listener);
  },
  onDidCloseTextDocument(listener: (document: unknown) => void): Disposable {
    return register(workspaceListeners.close, listener);
  },
  onDidChangeConfiguration(
    listener: (event: { affectsConfiguration(s: string): boolean }) => void,
  ): Disposable {
    return register(workspaceListeners.configuration, listener);
  },
  getConfiguration(_section?: string) {
    return {
      get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
    };
  },
  /** Minimal open-text-document stub. Accepts a `Uri` or the `{ content }`
   *  untitled form; the latter mints a fresh `untitled:` document. Callers here
   *  only read `.uri`/`.getText`/`.lineCount`. */
  openTextDocument(
    arg: UriImpl | { content?: string; language?: string },
  ): Promise<{ uri: UriImpl; getText(): string; lineCount: number }> {
    if (arg instanceof UriImpl) {
      return Promise.resolve({ uri: arg, getText: () => "", lineCount: 1 });
    }
    const content = arg.content ?? "";
    const uri = UriImpl.from({
      scheme: "untitled",
      path: `Untitled-${++untitledSeq}`,
    });
    const lineCount = content === "" ? 1 : content.split("\n").length;
    return Promise.resolve({ uri, getText: () => content, lineCount });
  },
  fs: {
    stat(_uri: unknown): Promise<{
      type: number;
      ctime: number;
      mtime: number;
      size: number;
      permissions: number;
    }> {
      return Promise.resolve({
        type: 1,
        ctime: 0,
        mtime: 0,
        size: 0,
        permissions: 0,
      });
    },
  },
  /** Paths `findFiles` resolves with; set via {@link setFindFilesResult}. */
  findFiles(_pattern: string): Promise<UriImpl[]> {
    return Promise.resolve(foundFiles.map((p) => UriImpl.file(p)));
  },
  /** Watcher stub recording its pattern and listeners in
   *  {@link fileSystemWatchers}, so tests can drive filesystem events through
   *  {@link emitFileCreate} / {@link emitFileDelete}. */
  createFileSystemWatcher(
    pattern: string | RelativePattern,
    ignoreCreateEvents = false,
    ignoreChangeEvents = false,
    ignoreDeleteEvents = false,
  ): {
    onDidChange(listener: (uri: UriImpl) => void): Disposable;
    onDidCreate(listener: (uri: UriImpl) => void): Disposable;
    onDidDelete(listener: (uri: UriImpl) => void): Disposable;
    dispose(): void;
  } {
    const record: WatcherRecord = {
      pattern,
      ignoreCreateEvents,
      ignoreChangeEvents,
      ignoreDeleteEvents,
      create: [],
      change: [],
      delete: [],
      disposed: false,
    };
    fileSystemWatchers.push(record);
    return {
      onDidChange: (listener) => register(record.change, listener),
      onDidCreate: (listener) => register(record.create, listener),
      onDidDelete: (listener) => register(record.delete, listener),
      dispose: () => {
        record.disposed = true;
      },
    };
  },
  applyEdit(edit: WorkspaceEdit): Promise<boolean> {
    appliedEdits.push(edit);
    const fire = (): void => {
      for (const r of edit.replacements) {
        for (const listener of workspaceListeners.change) {
          listener({ document: { uri: r.uri } });
        }
      }
    };
    if (applyEditManual) {
      return new Promise<boolean>((resolve) => {
        pendingApplies.push({ fire, resolve: () => resolve(applyEditResult) });
      });
    }
    // VSCode fires onDidChangeTextDocument synchronously while applying an
    // edit; mirror that so self-write guards can be exercised.
    fire();
    return Promise.resolve(applyEditResult);
  },
};

/** Fire all captured `onDidChangeTextDocument` listeners with `event`. */
export function emitChange(event: unknown): void {
  for (const listener of workspaceListeners.change) listener(event);
}

/** Fire all captured `onDidSaveTextDocument` listeners with `document`. */
export function emitSave(document: unknown): void {
  for (const listener of workspaceListeners.save) listener(document);
}

/**
 * Minimal `languages` namespace. The provider registrations are no-ops that
 * return a {@link Disposable} — the unit tests exercise the event glue, not
 * VSCode's provider routing.
 */
export const languages = {
  registerDefinitionProvider: (): Disposable => new Disposable(),
  registerHoverProvider: (): Disposable => new Disposable(),
  registerDocumentSymbolProvider: (): Disposable => new Disposable(),
  registerDocumentSemanticTokensProvider: (): Disposable => new Disposable(),
  registerCompletionItemProvider: (): Disposable => new Disposable(),
};

export const window = {
  get activeTextEditor(): { document: { uri: UriImpl } } | undefined {
    return activeTextEditorValue;
  },
  tabGroups: {
    get activeTabGroup(): { tabs: Tab[] } {
      return {
        get tabs(): Tab[] {
          return tabGroupModel[0]?.tabs ?? [];
        },
      };
    },
    get all(): TabGroup[] {
      return tabGroupModel;
    },
    close(tabOrTabs: Tab | Tab[]): Promise<void> {
      closedTabs.push(...(Array.isArray(tabOrTabs) ? tabOrTabs : [tabOrTabs]));
      return Promise.resolve();
    },
  },
  createOutputChannel(_name: string) {
    return {
      append: () => {},
      appendLine: () => {},
      replace: () => {},
      clear: () => {},
      show: () => {},
      hide: () => {},
      dispose: () => {},
    };
  },
  showInformationMessage(message: string): Promise<undefined> {
    recordedMessages.push({ level: "info", message });
    return Promise.resolve(undefined);
  },
  showWarningMessage(message: string): Promise<undefined> {
    recordedMessages.push({ level: "warning", message });
    return Promise.resolve(undefined);
  },
  showErrorMessage(message: string): Promise<undefined> {
    recordedMessages.push({ level: "error", message });
    return Promise.resolve(undefined);
  },
  registerWebviewViewProvider: (): Disposable => new Disposable(),
  registerCustomEditorProvider: (
    _viewType: string,
    _provider: unknown,
    _options?: unknown,
  ): Disposable => new Disposable(),
  showInputBox: (): Promise<string | undefined> =>
    Promise.resolve(promptAnswers.shift()),
  showQuickPick: (): Promise<string | undefined> =>
    Promise.resolve(promptAnswers.shift()),
  withProgress<T>(
    _options: unknown,
    task: (
      progress: { report(value: unknown): void },
      token: { isCancellationRequested: boolean },
    ) => Promise<T>,
  ): Promise<T> {
    return task({ report: () => {} }, { isCancellationRequested: false });
  },
  createQuickPick() {
    const noop = () => ({ dispose: () => {} });
    return {
      title: "",
      placeholder: "",
      matchOnDescription: false,
      busy: false,
      items: [] as unknown[],
      value: "",
      selectedItems: [] as unknown[],
      onDidChangeValue: noop,
      onDidAccept: noop,
      onDidHide: noop,
      show: () => {},
      hide: () => {},
      dispose: () => {},
    };
  },
};

/** Answers `showQuickPick` / `showInputBox` hand back, in prompt order. */
const promptAnswers: Array<string | undefined> = [];

/** Replace the answers a command's prompts will receive, oldest first. */
export function queuePromptAnswers(
  ...answers: Array<string | undefined>
): void {
  promptAnswers.length = 0;
  promptAnswers.push(...answers);
}

/** Recorded `commands.executeCommand` calls, so tests can assert which command
 *  a code path fired without a real extension host. */
export const executedCommands: Array<{ command: string; args: unknown[] }> = [];

/** Commands `registerCommand` captured, so tests can invoke one directly. */
const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();

/** Drop captured commands and queued prompt answers between tests. */
export function resetCommands(): void {
  registeredCommands.clear();
  promptAnswers.length = 0;
}

/** Run a registered command, or throw when nothing registered that id. */
export async function runCommand(
  command: string,
  ...args: unknown[]
): Promise<void> {
  const handler = registeredCommands.get(command);
  if (handler === undefined) throw new Error(`no such command: ${command}`);
  await handler(...args);
}

export const commands = {
  executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
    executedCommands.push({ command, args });
    // Built-in ids (`setContext`, `vscode.openWith`, …) are never registered,
    // so they record and resolve undefined.
    return Promise.resolve(registeredCommands.get(command)?.(...args));
  },
  registerCommand(
    command: string,
    handler: (...args: unknown[]) => unknown,
  ): Disposable {
    registeredCommands.set(command, handler);
    return new Disposable(() => registeredCommands.delete(command));
  },
};
