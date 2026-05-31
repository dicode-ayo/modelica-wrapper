/**
 * Tiny `vscode` stand-in for vitest unit tests. The real `vscode` module is
 * only available inside the extension host; for pure-logic tests we alias
 * imports of "vscode" to this file via `vitest.config.ts`.
 *
 * Only the surface area exercised by the unit tests is filled in. Add more
 * stubs here as new tests need them — keep them minimal and observable.
 */

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

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
} = { save: [], change: [], close: [] };

function register<T>(list: T[], listener: T): Disposable {
  list.push(listener);
  return new Disposable(() => {
    const i = list.indexOf(listener);
    if (i !== -1) list.splice(i, 1);
  });
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
  getConfiguration(_section?: string) {
    return {
      get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
    };
  },
};

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
  registerCompletionItemProvider: (): Disposable => new Disposable(),
};

export const window = {
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
  showInputBox: () => Promise.resolve(undefined),
};
