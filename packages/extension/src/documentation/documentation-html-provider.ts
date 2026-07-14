import * as vscode from "vscode";

import type { OmcClient } from "@dicode/omc-client";

import { log } from "../logger.js";
import { qualifiedNameFromUri } from "../source-provider.js";

export const MODELICA_DOC_SCHEME = "modelica-doc";

/** The subset of OMC this provider drives. */
interface DocHtmlClient {
  getDocumentationAnnotation(input: {
    typeName: string;
  }): Promise<{ info: string; revision: string; infoHeader: string }>;
  setDocumentationAnnotation(input: {
    typeName: string;
    info: string;
    revisions: string;
  }): Promise<{ bool: boolean }>;
  getClassInformation(input: {
    typeName: string;
  }): Promise<{ fileReadOnly: boolean }>;
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
 * `setDocumentationAnnotation` (carrying the current `revisions` so that section
 * isn't cleared) and notifies the class's `.mo` so the diagram/documentation
 * views reload. It also watches `.mo` changes and refreshes any open HTML editor,
 * so a WYSIWYG edit doesn't leave a stale HTML buffer that a later save would
 * clobber. Classes whose source is read-only, or that carry an
 * `__OpenModelica_infoHeader` the write API can't preserve, refuse writes.
 */
export class DocumentationHtmlProvider implements vscode.FileSystemProvider {
  private readonly _onDidChangeFile = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  private readonly versions = new Map<string, number>();

  constructor(
    private readonly ensureClient: () => Promise<OmcClient>,
    private readonly notifyClassChanged: (className: string) => void,
  ) {}

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
      const client: DocHtmlClient = await this.ensureClient();
      const { info, infoHeader } = await client.getDocumentationAnnotation({
        typeName: className,
      });
      const { fileReadOnly } = await client.getClassInformation({
        typeName: className,
      });
      const readOnly = fileReadOnly || infoHeader.trim().length > 0;
      return {
        type: vscode.FileType.File,
        ctime: 0,
        mtime,
        size: Buffer.byteLength(info, "utf8"),
        ...(readOnly ? { permissions: vscode.FilePermission.Readonly } : {}),
      };
    } catch (err) {
      log.warn(
        "documentationHtml",
        `stat ${className} failed; resolving as empty: ${(err as Error).message}`,
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
      const client: DocHtmlClient = await this.ensureClient();
      const { info } = await client.getDocumentationAnnotation({
        typeName: className,
      });
      return Buffer.from(info, "utf8");
    } catch (err) {
      log.warn(
        "documentationHtml",
        `readFile ${className} failed; returning empty: ${(err as Error).message}`,
      );
      return new Uint8Array();
    }
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const className = classFromDocHtmlUri(uri);
    if (!className) throw vscode.FileSystemError.FileNotFound(uri);
    const client: DocHtmlClient = await this.ensureClient();

    const { revision, infoHeader } = await client.getDocumentationAnnotation({
      typeName: className,
    });
    const { fileReadOnly } = await client.getClassInformation({
      typeName: className,
    });
    if (fileReadOnly || infoHeader.trim().length > 0) {
      throw vscode.FileSystemError.NoPermissions(uri);
    }

    const info = Buffer.from(content).toString("utf8");
    const { bool } = await client.setDocumentationAnnotation({
      typeName: className,
      info,
      revisions: revision,
    });
    if (!bool) {
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
