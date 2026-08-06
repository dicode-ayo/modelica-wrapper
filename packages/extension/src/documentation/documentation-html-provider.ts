import * as vscode from "vscode";

import { errorDetail } from "../error-detail.js";
import { log } from "../logger.js";
import { qualifiedNameFromUri } from "../source-provider.js";
import type {
  WriteAction,
  WriteVerdict,
  WriteVerdictClient,
  WriteVerdicts,
} from "../write-verdict.js";

export const MODELICA_DOC_SCHEME = "modelica-doc";

/** The subset of OMC this provider drives. */
export interface DocHtmlClient extends WriteVerdictClient {
  getDocumentationAnnotation(input: {
    typeName: string;
  }): Promise<{ info: string }>;
  setFullDocumentationAnnotation(input: {
    typeName: string;
    info: string;
  }): Promise<{ success: boolean }>;
}

interface DocState {
  info: string;
  verdict: WriteVerdict;
}

/** `modelica-doc:/Pkg.Cls.html` — a class's `Documentation(info=…)` as an editable file. */
export function docHtmlUriFor(className: string): vscode.Uri {
  return vscode.Uri.parse(`${MODELICA_DOC_SCHEME}:/${className}.html`);
}

function classFromDocHtmlUri(uri: vscode.Uri): string | undefined {
  if (uri.scheme !== MODELICA_DOC_SCHEME) return undefined;
  const name = uri.path.replace(/^\//, "").replace(/\.html$/i, "");
  return name.length > 0 ? name : undefined;
}

/**
 * Serves a class's `Documentation(info=…)` HTML as an editable `modelica-doc:`
 * file so it can be edited in a native VSCode HTML editor. Reads render the
 * current annotation from OMC; a save writes it back through
 * `setFullDocumentationAnnotation`, which preserves `revisions` and
 * `infoHeader` on its own, and notifies the class's `.mo` so the
 * diagram/documentation views reload. It also watches `.mo` changes and
 * refreshes any open HTML editor, so a WYSIWYG edit doesn't leave a stale
 * HTML buffer that a later save would clobber. A class whose source is
 * read-only refuses writes.
 */
export class DocumentationHtmlProvider implements vscode.FileSystemProvider {
  private readonly _onDidChangeFile = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  private readonly versions = new Map<string, number>();

  constructor(
    private readonly ensureClient: () => Promise<DocHtmlClient>,
    private readonly notifyClassChanged: (className: string) => void,
    private readonly verdicts: WriteVerdicts,
  ) {}

  /** The class's current documentation and whether it may be written. */
  private async docState(
    className: string,
    action: WriteAction,
  ): Promise<DocState> {
    const client = await this.ensureClient();
    const { info } = await client.getDocumentationAnnotation({
      typeName: className,
    });
    const verdict = await this.verdicts.forClass(client, className, action);
    return { info, verdict };
  }

  /**
   * Refresh the open HTML editor for a class when its `.mo` changed elsewhere (a
   * WYSIWYG edit, an undo). Wire this to `onDidChangeTextDocument` for
   * `modelica-source:` documents.
   */
  refreshFromClass(className: string): void {
    const uri = docHtmlUriFor(className);
    this.versions.set(uri.toString(), Date.now());
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const className = classFromDocHtmlUri(uri);
    if (!className) throw vscode.FileSystemError.FileNotFound(uri);
    const mtime = this.versions.get(uri.toString()) ?? 0;
    try {
      const { info, verdict } = await this.docState(className, "edit");
      return {
        type: vscode.FileType.File,
        ctime: 0,
        mtime,
        size: Buffer.byteLength(info, "utf8"),
        ...(verdict.ok ? {} : { permissions: vscode.FilePermission.Readonly }),
      };
    } catch (err) {
      log.warn(
        "documentationHtml",
        `stat ${className} failed; resolving as empty: ${errorDetail(err)}`,
      );
      return { type: vscode.FileType.File, ctime: 0, mtime, size: 0 };
    }
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  createDirectory(): void {
    /* no-op: a single flat namespace */
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const className = classFromDocHtmlUri(uri);
    if (!className) throw vscode.FileSystemError.FileNotFound(uri);
    try {
      const client = await this.ensureClient();
      const { info } = await client.getDocumentationAnnotation({
        typeName: className,
      });
      await this.verdicts.capture(client, className);
      return Buffer.from(info, "utf8");
    } catch (err) {
      // Unlike the `.mo` provider, this file exists to be edited and saved:
      // serving empty on a transient read failure would let the first save write
      // empty `info` over the real documentation. Fail loudly instead.
      throw vscode.FileSystemError.Unavailable(
        `could not read the documentation for ${className}: ${errorDetail(err)}`,
      );
    }
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const className = classFromDocHtmlUri(uri);
    if (!className) throw vscode.FileSystemError.FileNotFound(uri);
    const client = await this.ensureClient();

    const { verdict } = await this.docState(className, "save");
    if (!verdict.ok) {
      throw vscode.FileSystemError.NoPermissions(verdict.reason);
    }

    const info = Buffer.from(content).toString("utf8");
    const { success } = await client.setFullDocumentationAnnotation({
      typeName: className,
      info,
    });
    if (!success) {
      throw vscode.FileSystemError.Unavailable(
        `OMC rejected the documentation for ${className}`,
      );
    }

    this.versions.set(uri.toString(), Date.now());
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    // Reflect into the class's `.mo` so the diagram/documentation views reload.
    this.notifyClassChanged(className);
  }

  delete(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  rename(oldUri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(oldUri);
  }
}

/**
 * Wire `.mo` document changes to the HTML provider so an open HTML editor
 * refreshes after a WYSIWYG edit or an undo touched the same class.
 */
export function wireDocHtmlRefresh(
  provider: DocumentationHtmlProvider,
): vscode.Disposable {
  return vscode.workspace.onDidChangeTextDocument((e) => {
    const className = qualifiedNameFromUri(e.document.uri);
    if (className) provider.refreshFromClass(className);
  });
}
