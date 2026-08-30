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
 *  - `stat`      → reports `Readonly` permission when the class's write
 *    verdict refuses (e.g. MSL libraries installed under
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
import {
  fileOwnerClass,
  realSourceFilename,
  type FileOwnerClient,
} from "./file-owner.js";
import {
  bufferRefusal,
  multiEntityMessage,
  multipleTopLevelClasses,
} from "./single-entity-file.js";
import type { SelfWriteGuard } from "./self-write-guard.js";
import type { WriteVerdicts } from "./write-verdict.js";

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

  constructor(
    private readonly ensureClient: EnsureClient,
    private readonly guard: SelfWriteGuard,
    private readonly verdicts: WriteVerdicts,
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
      const { contents } = await client.listFile({ typeName });
      const verdict = await this.verdicts.forClass(client, typeName, "edit");
      return {
        type: vscode.FileType.File,
        ctime: 0,
        mtime,
        size: Buffer.byteLength(contents, "utf8"),
        ...(verdict.ok ? {} : { permissions: vscode.FilePermission.Readonly }),
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
      await this.verdicts.capture(client, typeName);
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

    const client = await this.ensureClient();

    // Refuse before any OMC mutation so a save can't corrupt an installed
    // library's source.
    const verdict = await this.verdicts.forClass(client, typeName, "save");
    if (!verdict.ok) {
      throw vscode.FileSystemError.NoPermissions(verdict.reason);
    }

    const text = Buffer.from(content).toString("utf8");

    // A transient OMC failure makes `readFile` seed an EMPTY buffer for a real
    // class; saving that would `loadString("")` (no error) and truncate the
    // on-disk source. A class never legitimately has empty source, so refuse.
    if (text.trim().length === 0) {
      throw vscode.FileSystemError.Unavailable(
        `refusing to save empty source over ${typeName}`,
      );
    }

    // Read for `fileName` — the verdict above consumed only the permission.
    const info = await client.getClassInformation({ typeName });
    const onDisk = isLikelyDiskPath(info.fileName);

    // Both screens sit ahead of the `loadString` below to keep this method's
    // "refuse before any OMC mutation" promise. The buffer would bind every
    // class it declares to `info.fileName`; the file may have gained a class
    // from an external edit since it loaded. Either way the write that follows
    // reconstructs the file from one class and drops the rest (#452). A file
    // OMC cannot parse falls through — refusing there would block saving a fix
    // over a corrupted file, and the buffer screen still holds.
    if (onDisk) {
      const inFile = await multipleTopLevelClasses(client, info.fileName);
      if (inFile) {
        throw vscode.FileSystemError.Unavailable(
          multiEntityMessage(info.fileName, inFile),
        );
      }
    }
    // OMC keys a class to its file, so a class stored inline in a shared
    // `package.mo` stays in place with its siblings — passing a per-class
    // pseudo-filename evicts it from that file. A memory-only class has no
    // disk path yet, so it carries the buffer URI until `setSourceFile`. Both
    // the buffer screen above and the `loadString` below key off this same
    // filename: the screen exists to predict what `loadString` binds to.
    const bindFilename = onDisk ? info.fileName : uri.toString();
    const refusal = await bufferRefusal(client, {
      data: text,
      filename: bindFilename,
      expected: typeName,
      label: onDisk ? info.fileName : typeName,
    });
    if (refusal !== undefined) {
      throw vscode.FileSystemError.Unavailable(refusal);
    }

    // Drain any stale errors so the post-loadString check below only sees
    // diagnostics produced by this save.
    await client.getErrorString();

    // Update OMC's in-memory AST, under the same filename the screen above
    // just checked the buffer against.
    const { success } = await client.loadString({
      data: text,
      filename: bindFilename,
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

    if (onDisk) {
      // (a) Write through to the existing on-disk source. When the class shares
      // its file with siblings (an inline package member), write the whole file
      // — `listFile` of the file's owning class — so the save doesn't drop the
      // siblings. A class that owns its file writes its buffer verbatim.
      const owner = await fileOwnerClass(client, typeName);
      if (owner === typeName) {
        await this.guard.write(info.fileName, text);
      } else {
        const { contents } = await client.listFile({ typeName: owner });
        // Same truncation guard as the member path: an empty owner listing
        // (owner momentarily unresolved) would blank the shared file, taking
        // every sibling with it.
        if (contents.trim().length === 0) {
          throw vscode.FileSystemError.Unavailable(
            `refusing to save empty source over ${info.fileName}`,
          );
        }
        await this.guard.write(info.fileName, contents);
      }
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

/**
 * The filename to hand OMC when loading `uri`'s buffer back in. `loadString`
 * binds a class to the filename it is given and drops it from the file it was
 * stored in, so a class with a real source must be reloaded under that path;
 * one that is memory-only carries the buffer URI until `setSourceFile`.
 */
export async function omcFilenameForDocument(
  client: FileOwnerClient,
  uri: vscode.Uri,
): Promise<string> {
  const resolved = await realSourceFilename(client, qualifiedNameFromUri(uri));
  return resolved ?? uri.toString();
}
