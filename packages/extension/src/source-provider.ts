/**
 * Writable virtual filesystem for Modelica source listings.
 *
 * URIs use the `modelica-source` scheme; the path is the dotted Modelica
 * name suffixed with `.mo` (e.g. `modelica-source:/Modelica.Blocks.Math.Add.mo`).
 * Content is OMC's pretty-printed source via `listFile(<typeName>)`.
 *
 * Behavior:
 *  - `readFile`  → OMC `listFile`
 *  - `writeFile` → parse-validate via OMC `loadString`; on success, persist
 *    to disk. Two paths:
 *      (a) Class already has a real on-disk source (`fileName` is an
 *          absolute disk path): write through to that path.
 *      (b) Class is OMC-memory-only (fileName is empty or a pseudo-URI like
 *          `<runtime:...>` / `modelica-source:...`): materialize under the
 *          workspace folder as nested directories with `package.mo` files
 *          mirroring the dotted name (e.g. `MyLib.Sub.Model` →
 *          `<ws>/MyLib/package.mo` + `<ws>/MyLib/Sub/package.mo` +
 *          `<ws>/MyLib/Sub/Model.mo`). Existing parent package.mo files are
 *          left untouched; only missing ones are created. After writing,
 *          `setSourceFile` tells OMC where the class now lives so subsequent
 *          saves take path (a).
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

import type { OmcClient } from "@dicode/omc-client";

import {
  isLikelyDiskPath,
  linkPersistedClass,
  persistClassUnderWorkspace,
} from "./persist.js";

export { isLikelyDiskPath, linkPersistedClass, persistClassUnderWorkspace };
export type { PersistResult } from "./persist.js";

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
      ...(info.fileReadOnly
        ? { permissions: vscode.FilePermission.Readonly }
        : {}),
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

    // Snapshot fileName before loadString — loadString rewrites OMC's
    // `fileName` field for the class to whatever pseudo-filename we pass it,
    // so we'd lose the disk path otherwise.
    const info = await client.getClassInformation({ typeName });
    if (info.fileReadOnly) {
      throw vscode.FileSystemError.NoPermissions(uri);
    }

    // Drain any stale errors so the post-loadString check below only sees
    // diagnostics produced by this save.
    await client.getErrorString();

    // Update OMC's in-memory AST. `merge=false` (the default) replaces the
    // existing class; we pass the source URI as a pseudo-filename so OMC's
    // diagnostics point back at this buffer until `setSourceFile` updates it.
    const { success } = await client.loadString({
      data: text,
      filename: uri.toString(),
    });
    const { errorString } = await client.getErrorString();
    if (!success || (errorString.length > 0 && /error/i.test(errorString))) {
      // Surface to VSCode so the editor keeps the dirty state and the user
      // sees a banner; the live-check pipeline will also pin the precise
      // squiggle. Keep the message short — the full text lives in the
      // Modelica output channel after `getMessagesStringInternal` runs.
      const first =
        errorString.split("\n")[0]?.slice(0, 200) ?? errorString.slice(0, 200);
      throw vscode.FileSystemError.Unavailable(
        `OMC rejected the source${first ? `: ${first}` : ""}`,
      );
    }

    if (isLikelyDiskPath(info.fileName)) {
      // (a) Write through to the existing on-disk source.
      const fsp = await import("node:fs/promises");
      await fsp.writeFile(info.fileName, text, "utf8");
    } else {
      // (b) OMC-memory-only class — materialize under the workspace folder.
      const ws = vscode.workspace.workspaceFolders?.[0];
      if (!ws) {
        // No workspace folder open: we can't pick a disk location.
        // Keep OMC's in-memory copy and warn — the buffer stays "saved"
        // from VSCode's perspective so the user doesn't lose the edit.
        await vscode.window.showWarningMessage(
          `Modelica: ${typeName} updated in OMC memory only — open a folder to enable on-disk save.`,
        );
      } else {
        const result = await persistClassUnderWorkspace(
          client,
          ws.uri.fsPath,
          typeName,
          text,
          info.restriction === "package" ? "package" : undefined,
        );
        await linkPersistedClass(client, typeName, result);
      }
    }

    this.bump(uri);
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
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
  const p = uri.path.replace(/^\//, "");
  return p.endsWith(".mo") ? p.slice(0, -3) : p;
}
