/**
 * Writable virtual filesystem for Modelica source listings.
 *
 * URIs use the `modelica-source` scheme; the path is the dotted Modelica
 * name suffixed with `.mo` (e.g. `modelica-source:/Modelica.Blocks.Math.Add.mo`).
 * Content is OMC's pretty-printed source via `listFile(<typeName>)`.
 *
 * Behavior:
 *  - `readFile`  → OMC `listFile`
 *  - `writeFile` → OMC `loadString` (in-memory update); when the class has a
 *    writable on-disk source path (`fileName` non-empty + `fileReadOnly` ==
 *    false), the new text is also persisted to that file via node:fs/promises.
 *  - `stat`      → reports `Readonly` permission when OMC says the class
 *    sources are read-only (e.g. MSL libraries installed under
 *    `~/.openmodelica/libraries`). VSCode then refuses to write.
 *  - `notifySourceChanged(typeName)` — fired by commands that mutate OMC
 *    state outside `writeFile` (e.g. `addComponent`, `addConnection`). This
 *    bumps the per-URI mtime and emits `onDidChangeFile`, so open editors
 *    auto-reload.
 *
 * Conversion from `TextDocumentContentProvider` to `FileSystemProvider`
 * makes the editor buffer writable, which Phase 2's auto-check pipeline
 * depends on (typing into the buffer must be observable via
 * `onDidChangeTextDocument`).
 */

import * as vscode from "vscode";

import type { OmcClient } from "@modelica-wrapper/omc-client";

export const MODELICA_SOURCE_SCHEME = "modelica-source";

type EnsureClient = () => Promise<OmcClient>;

export class ModelicaSourceProvider implements vscode.FileSystemProvider {
  private readonly _onDidChangeFile = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  /** Per-URI version counter used as mtime; bumped on write + external invalidate. */
  private readonly versions = new Map<string, number>();

  constructor(private readonly ensureClient: EnsureClient) {}

  // No real watchers; OMC mutations are surfaced via `notifySourceChanged`.
  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const typeName = qualifiedNameFromUri(uri);
    if (!typeName) throw vscode.FileSystemError.FileNotFound(uri);
    const client = await this.ensureClient();
    const info = await client.getClassInformation({ typeName });
    const { contents } = await client.listFile({ typeName });
    const mtime = this.versions.get(uri.toString()) ?? 0;
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime,
      size: Buffer.byteLength(contents, "utf8"),
      ...(info.fileReadOnly ? { permissions: vscode.FilePermission.Readonly } : {}),
    };
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  createDirectory(): void {
    /* no-op: we expose a single flat namespace */
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const typeName = qualifiedNameFromUri(uri);
    if (!typeName) throw vscode.FileSystemError.FileNotFound(uri);
    const client = await this.ensureClient();
    const { contents } = await client.listFile({ typeName });
    return Buffer.from(contents, "utf8");
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const typeName = qualifiedNameFromUri(uri);
    if (!typeName) throw vscode.FileSystemError.FileNotFound(uri);
    const client = await this.ensureClient();
    const text = Buffer.from(content).toString("utf8");

    // Check read-only status BEFORE loadString — refuse to write to MSL etc.
    const info = await client.getClassInformation({ typeName });
    if (info.fileReadOnly) {
      throw vscode.FileSystemError.NoPermissions(uri);
    }

    // Update OMC's in-memory AST. `merge=false` (the default) replaces the
    // existing class; we pass the source URI as a pseudo-filename so OMC's
    // diagnostics point back at this buffer.
    await client.loadString({
      data: text,
      filename: uri.toString(),
    });
    const { errorString } = await client.getErrorString();
    if (errorString.length > 0 && /error/i.test(errorString)) {
      // Surface to VSCode so the editor keeps the dirty state and the user
      // sees a banner; the live-check pipeline will also pin the precise
      // squiggle. Keep the message short — the full text lives in the
      // Modelica output channel after `getMessagesStringInternal` runs.
      throw vscode.FileSystemError.Unavailable(
        `OMC rejected the source: ${errorString.split("\n")[0]?.slice(0, 200) ?? errorString.slice(0, 200)}`,
      );
    }

    // Persist to the on-disk source file when one exists. Class definitions
    // created via `loadString` from an in-memory buffer report
    // `fileName === ""` (or the pseudo-URI); skip disk writes in that case.
    if (info.fileName && info.fileName.length > 0 && !info.fileReadOnly) {
      // node:fs/promises — dynamic import keeps the bundle non-coupled in
      // browser-target builds (the extension host target is node but webview
      // imports the same module graph through diagram-ui types).
      const { writeFile } = await import("node:fs/promises");
      await writeFile(info.fileName, text, "utf8");
    }

    this.bump(uri);
    this._onDidChangeFile.fire([
      { type: vscode.FileChangeType.Changed, uri },
    ]);
  }

  delete(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  rename(oldUri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(oldUri);
  }

  /**
   * External hook: call when OMC mutates a class outside writeFile (e.g.
   * `addComponent`, `addConnection`). Bumps the per-URI mtime and fires
   * onDidChangeFile so open editors reload from `readFile`.
   *
   * Pass `undefined` to invalidate all currently-open `modelica-source:`
   * documents — useful for coarse refreshes after a `loadFile` of a package.
   */
  notifySourceChanged(typeName?: string): void {
    if (typeName) {
      const uri = sourceUriFor(typeName);
      this.bump(uri);
      this._onDidChangeFile.fire([
        { type: vscode.FileChangeType.Changed, uri },
      ]);
      return;
    }
    const events: vscode.FileChangeEvent[] = [];
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme === MODELICA_SOURCE_SCHEME) {
        this.bump(doc.uri);
        events.push({ type: vscode.FileChangeType.Changed, uri: doc.uri });
      }
    }
    if (events.length > 0) this._onDidChangeFile.fire(events);
  }

  private bump(uri: vscode.Uri): void {
    this.versions.set(uri.toString(), Date.now());
  }
}

export function sourceUriFor(qualifiedName: string): vscode.Uri {
  return vscode.Uri.parse(`${MODELICA_SOURCE_SCHEME}:/${qualifiedName}.mo`);
}

export function qualifiedNameFromUri(uri: vscode.Uri): string | undefined {
  if (uri.scheme !== MODELICA_SOURCE_SCHEME) return undefined;
  const path = uri.path.replace(/^\//, "");
  return path.endsWith(".mo") ? path.slice(0, -3) : path;
}
