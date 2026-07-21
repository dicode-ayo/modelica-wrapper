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
 *    to disk. Two paths, chosen from the disk path snapshotted at first
 *    `readFile` (not OMC's live `fileName`, which our own `loadString`
 *    repoints to this scheme's URI on every save):
 *      (a) Class already has a real on-disk source: write through to that
 *          path.
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

import { log } from "./logger.js";

import {
  isLikelyDiskPath,
  linkPersistedClass,
  persistClassUnderWorkspace,
} from "./persist.js";
import type { SelfWriteGuard } from "./self-write-guard.js";
import { isSystemLibraryClass } from "./system-library.js";

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

  /**
   * Per-class read-only verdict, captured on first read (before any mutation
   * repoints the class's source path away from its MODELICAPATH origin).
   */
  private readonly readOnly = new Map<string, boolean>();

  /**
   * Per-class on-disk source path, captured on first read. A save's own
   * `loadString` repoints OMC's live `fileName` to this scheme's pseudo-URI,
   * so a second save in the same session must not re-derive "is this class
   * already on disk?" from OMC's current state — it would see the pseudo-URI
   * and wrongly conclude the class is memory-only, extracting it to a new
   * file next to its real one. `undefined` means the class had no disk
   * origin at first read (still OMC-memory-only).
   */
  private readonly sourcePath = new Map<string, string | undefined>();

  constructor(
    private readonly ensureClient: EnsureClient,
    private readonly guard: SelfWriteGuard,
  ) {}

  // No real watchers; OMC mutations are surfaced via `notifySourceChanged`.
  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const typeName = qualifiedNameFromUri(uri);
    if (!typeName) throw vscode.FileSystemError.FileNotFound(uri);
    const mtime = this.versions.get(uri.toString()) ?? 0;
    // A custom editor (the diagram) restores its document by URI on window
    // reload, which can `stat` a class before workspace-autoload has loaded it
    // — or one that no longer exists. Throwing here surfaces as VSCode's opaque
    // "Unable to resolve resource"; resolve to an empty file instead so the
    // editor opens and can report a clean not-loaded state.
    try {
      const client = await this.ensureClient();
      const info = await client.getClassInformation({ typeName });
      const { contents } = await client.listFile({ typeName });
      // A system-library class is read-only by origin even when its file is
      // writable on disk, so `fileReadOnly` alone misses it.
      const readOnly = info.fileReadOnly || (await this.isReadOnly(typeName));
      return {
        type: vscode.FileType.File,
        ctime: 0,
        mtime,
        size: Buffer.byteLength(contents, "utf8"),
        ...(readOnly ? { permissions: vscode.FilePermission.Readonly } : {}),
      };
    } catch (err) {
      log.warn(
        "modelicaSource",
        `stat ${typeName} failed; resolving as empty: ${(err as Error).message}`,
      );
      return { type: vscode.FileType.File, ctime: 0, mtime, size: 0 };
    }
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
    try {
      const client = await this.ensureClient();
      const { contents } = await client.listFile({ typeName });
      // Capture the read-only verdict and on-disk source path now, while the
      // class still points at its on-disk origin — a later edit repoints it
      // to this scheme's URI.
      await this.isReadOnly(typeName);
      await this.sourcePathFor(typeName);
      return Buffer.from(contents, "utf8");
    } catch (err) {
      // Mirror `stat`: a class that isn't loaded (or no longer exists) reads as
      // empty rather than hard-failing the editor that opened it.
      log.warn(
        "modelicaSource",
        `readFile ${typeName} failed; returning empty: ${(err as Error).message}`,
      );
      return new Uint8Array();
    }
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const typeName = qualifiedNameFromUri(uri);
    if (!typeName) throw vscode.FileSystemError.FileNotFound(uri);

    // System libraries (loaded from MODELICAPATH) are read-only by origin even
    // when their files are writable on disk. Refuse before any OMC mutation so
    // a save can't corrupt an installed library's source.
    if (await this.isReadOnly(typeName)) {
      throw vscode.FileSystemError.NoPermissions(
        `${typeName} belongs to a read-only system library`,
      );
    }

    const client = await this.ensureClient();
    const text = Buffer.from(content).toString("utf8");

    // A transient OMC failure makes `readFile` seed an EMPTY buffer for a real
    // class; saving that would `loadString("")` (no error) and truncate the
    // on-disk source. A class never legitimately has empty source, so refuse.
    if (text.trim().length === 0) {
      throw vscode.FileSystemError.Unavailable(
        `refusing to save empty source over ${typeName}`,
      );
    }

    // Snapshot fileName before loadString — loadString rewrites OMC's
    // `fileName` field for the class to whatever pseudo-filename we pass it,
    // so we'd lose the disk path otherwise.
    const info = await client.getClassInformation({ typeName });
    if (info.fileReadOnly) {
      throw vscode.FileSystemError.NoPermissions(uri);
    }

    // Not `info.fileName`: on a second save that field is already the
    // pseudo-URI our prior loadString wrote, so trusting it would
    // misclassify an already-on-disk class as memory-only and extract a
    // second copy. `sourcePathFor` reads the origin snapshotted at first read.
    const diskPath = await this.sourcePathFor(typeName);

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

    if (diskPath) {
      // (a) Write through to the existing on-disk source.
      await this.guard.write(diskPath, text);
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
        const { restriction } = await client.getClassInformation({ typeName });
        const result = await persistClassUnderWorkspace(
          client,
          ws.uri.fsPath,
          typeName,
          text,
          this.guard,
          restriction === "package" ? "package" : undefined,
        );
        await linkPersistedClass(client, typeName, result);
        // Remember the new disk path so a later save this session writes
        // through to it instead of extracting a second copy.
        this.sourcePath.set(typeName, result.leafPath);
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
   * `addComponent`, `addConnection`), or when a class's on-disk origin moves
   * (`setSourceFile` from `savePackage`, an external rename picked up by the
   * `.mo` watcher). Bumps the per-URI mtime and fires onDidChangeFile so open
   * editors reload from `readFile`; also drops the cached read-only verdict
   * and disk path so they're re-derived from OMC's current state instead of
   * the stale snapshot from the class's first read.
   *
   * Pass `undefined` to invalidate all currently-open `modelica-source:`
   * documents — useful for coarse refreshes after a `loadFile` of a package.
   */
  notifySourceChanged(typeName?: string): void {
    if (typeName) {
      this.readOnly.delete(typeName);
      this.sourcePath.delete(typeName);
      const uri = sourceUriFor(typeName);
      this.bump(uri);
      this._onDidChangeFile.fire([
        { type: vscode.FileChangeType.Changed, uri },
      ]);
      return;
    }
    this.readOnly.clear();
    this.sourcePath.clear();
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

  /**
   * Whether `typeName` is a read-only system-library class. Memoized on the
   * first lookup — which `readFile` forces before any edit — so the verdict
   * reflects the class's on-disk origin, not a source path a mutation has since
   * repointed to this scheme's URI. Failures don't block editing.
   */
  async isReadOnly(typeName: string): Promise<boolean> {
    const cached = this.readOnly.get(typeName);
    if (cached !== undefined) return cached;
    try {
      const client = await this.ensureClient();
      const verdict = await isSystemLibraryClass(client, typeName);
      this.readOnly.set(typeName, verdict);
      return verdict;
    } catch {
      return false;
    }
  }

  /**
   * The class's real on-disk source path, or `undefined` if it's still
   * OMC-memory-only. Memoized on first lookup — which `readFile` forces
   * before any edit — for the same reason as `isReadOnly`: a mutation
   * repoints OMC's live `fileName` to this scheme's URI, so re-deriving this
   * from OMC's current state on a later save would misclassify an
   * already-on-disk class as memory-only.
   */
  private async sourcePathFor(typeName: string): Promise<string | undefined> {
    if (this.sourcePath.has(typeName)) return this.sourcePath.get(typeName);
    try {
      const client = await this.ensureClient();
      const { fileName } = await client.getSourceFile({ typeName });
      const resolved = isLikelyDiskPath(fileName) ? fileName : undefined;
      this.sourcePath.set(typeName, resolved);
      return resolved;
    } catch {
      return undefined;
    }
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
