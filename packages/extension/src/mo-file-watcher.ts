/**
 * Keeps OMC — and therefore the library sidebar — in sync with bare `.mo`
 * file edits: a save in the plain text editor, or a create/delete/rename in
 * the Explorer or from outside VSCode. Scoped to workspace folders; the
 * read-only MODELICAPATH libraries are never watched.
 *
 * OMC stays the single source the tree lists from, so every reaction routes
 * through the targeted change protocol (`childrenChanged`) rather than a
 * wholesale reload:
 *   - change / create → `loadFile`, then re-list the affected scopes.
 *   - delete → `deleteClass` for the classes the gone file declared (resolved
 *     from a path→class index, since the file can no longer be parsed), then
 *     re-list their enclosing scope.
 *
 * Both announce each touched class through `notifySourceChanged`. The
 * per-class caches — sidebar icons, class restrictions, the language caches —
 * hang off that one broadcast through `invalidation.ts`, so the watcher
 * invalidates none of them directly.
 *
 * A `package.order` edit resolves the owning package from the path→class index
 * and reloads its `package.mo`, which re-derives the child order from disk.
 *
 * The watcher leaves two kinds of edit alone:
 *   - our own disk writes, matched by content through the {@link SelfWriteGuard}
 *     so a save doesn't fight the custom editor's shadow-buffer sync;
 *   - an edit to a class open *and dirty* in an editor, where reloading OMC
 *     would clobber the unsaved buffer — skipped with a warning until it saves.
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";

import * as vscode from "vscode";

import { enclosingScope } from "@dicode/modelica-lang-core";

import { pathExists } from "./fs-util.js";
import { log } from "./logger.js";
import type { SelfWriteGuard } from "./self-write-guard.js";
import {
  MODELICA_SOURCE_SCHEME,
  sourceUriFor,
  type ModelicaSourceProvider,
} from "./source-provider.js";
import type { LibraryWebviewProvider } from "./library/library-webview-provider.js";

interface WatcherOmcClient {
  loadFile(input: { fileName: string }): Promise<{ success: boolean }>;
  parseFile(input: { fileName: string }): Promise<{ classNames: string[] }>;
  deleteClass(input: { typeName: string }): Promise<{ success: boolean }>;
}

/** Maps a normalized `.mo` path to the fully-qualified classes it declares. */
export interface PathClassIndex {
  get(fsPath: string): string[] | undefined;
  set(fsPath: string, classNames: string[]): void;
  delete(fsPath: string): void;
  /** Every indexed class at or under `qualifiedName`, itself included. */
  classesUnder(qualifiedName: string): string[];
}

export function createPathClassIndex(): PathClassIndex {
  const byPath = new Map<string, string[]>();
  const key = (p: string): string => path.resolve(p);
  return {
    get: (p) => byPath.get(key(p)),
    set: (p, names) => void byPath.set(key(p), names),
    delete: (p) => void byPath.delete(key(p)),
    classesUnder(qualifiedName) {
      const prefix = `${qualifiedName}.`;
      const found: string[] = [];
      for (const names of byPath.values()) {
        for (const name of names) {
          if (name === qualifiedName || name.startsWith(prefix)) {
            found.push(name);
          }
        }
      }
      return found;
    },
  };
}

export interface MoWatcherDeps {
  ensureClient: () => Promise<WatcherOmcClient>;
  libraryTree: Pick<LibraryWebviewProvider, "childrenChanged">;
  sourceProvider: Pick<ModelicaSourceProvider, "notifySourceChanged">;
  guard: SelfWriteGuard;
  index: PathClassIndex;
  /** Read a file's text; injected so tests need no real disk. */
  readFile: (fsPath: string) => Promise<string>;
  /** True iff `fsPath` is still on disk; injected so tests need no real disk. */
  fileExists: (fsPath: string) => Promise<boolean>;
  /** True when a declared class is open and dirty — reloading would clobber it. */
  isBusy: (fsPath: string, classNames: string[]) => boolean;
}

/** `""` (top-level scope) maps to the root listing; a nested scope stays as-is. */
function scopeOf(qualifiedName: string): string | null {
  const scope = enclosingScope(qualifiedName);
  return scope === "" ? null : scope;
}

/** `fsPath` is the file whose edit is being skipped — a delete has no "changed" to report either. */
function warnBusy(fsPath: string, classNames: string[]): void {
  void vscode.window.showWarningMessage(
    `Modelica: ${classNames.join(", ")} has unsaved edits open, so the ` +
      `${path.basename(fsPath)} reload was skipped. Save or close the editor to pick up the disk version.`,
  );
}

/**
 * A skipped reorder is terminal: saving the busy editor reloads that member
 * alone, and nothing re-runs the reorder (issue #440). So this says what
 * actually recovers it, where a `.mo` reload can promise the save is enough
 * (issue #419).
 */
function warnReorderBusy(describedPath: string, classNames: string[]): void {
  void vscode.window.showWarningMessage(
    `Modelica: a class in ${classNames.join(", ")} has unsaved edits open, so ` +
      `the ${path.basename(describedPath)} reload was skipped. Save or close ` +
      `the editor, then edit ${path.basename(describedPath)} again or refresh ` +
      `the library.`,
  );
}

/**
 * React to a `.mo` file appearing or changing on disk. Loads the new content
 * into OMC and refreshes the tree for every class the file now declares, and
 * unloads any class the file previously declared but no longer does.
 */
export async function handleMoChange(
  deps: MoWatcherDeps,
  fsPath: string,
): Promise<void> {
  let text: string;
  try {
    text = await deps.readFile(fsPath);
  } catch {
    // Raced with a delete, or unreadable — nothing to load.
    return;
  }
  if (deps.guard.claim(fsPath, text)) return;

  const client = await deps.ensureClient();
  let names: string[];
  try {
    ({ classNames: names } = await client.parseFile({ fileName: fsPath }));
  } catch (err) {
    log.warn("moWatcher", `parseFile ${fsPath} failed: ${asMessage(err)}`);
    return;
  }

  const previous = deps.index.get(fsPath) ?? [];
  const removed = previous.filter((n) => !names.includes(n));
  const affected = [...names, ...removed];
  if (deps.isBusy(fsPath, affected)) {
    warnBusy(fsPath, affected);
    return;
  }

  const { success } = await client.loadFile({ fileName: fsPath });
  if (!success) {
    log.warn("moWatcher", `loadFile ${fsPath} returned success=false`);
    return;
  }
  for (const name of removed) await client.deleteClass({ typeName: name });
  deps.index.set(fsPath, names);

  const scopes = new Set<string | null>();
  for (const name of names) {
    scopes.add(name);
    scopes.add(scopeOf(name));
  }
  for (const name of removed) scopes.add(scopeOf(name));
  for (const scope of scopes) deps.libraryTree.childrenChanged(scope);
  for (const name of removed) deps.sourceProvider.notifySourceChanged(name);
  for (const name of names) deps.sourceProvider.notifySourceChanged(name);
}

/** `dirname(orderFsPath)/package.mo` — the file that owns a `package.order`. */
function orderOwner(orderFsPath: string): string {
  return path.join(path.dirname(orderFsPath), "package.mo");
}

/**
 * Reload the package that owns `pkgFile`, then re-list it. The class list
 * itself is unaffected by a reorder, so the index needs no update.
 *
 * `describedPath` names the file whose edit triggered this, so a busy warning
 * points at what the user touched rather than at `package.mo`.
 */
async function reorderPackage(
  deps: MoWatcherDeps,
  pkgFile: string,
  describedPath: string,
): Promise<void> {
  const names = deps.index.get(pkgFile);
  if (names === undefined || names.length === 0) {
    log.warn(
      "moWatcher",
      `package.order edit for ${pkgFile}, but it is not indexed`,
    );
    return;
  }
  // Reloading the package re-reads every member from disk, so a dirty buffer
  // for a *member* — not just the package itself — is at risk of being
  // clobbered underneath its editor.
  const affected = names.flatMap((name) => deps.index.classesUnder(name));
  if (deps.isBusy(pkgFile, affected)) {
    warnReorderBusy(describedPath, names);
    return;
  }

  // `loadFile` on the package re-derives the child order from `package.order`,
  // for nested packages as well as this one, and picks up a member added
  // alongside it — see `package-order-reload.integration.test.ts`. Nothing has
  // to be unloaded first, and nothing is: a failed reload leaves OMC holding
  // the order it already had, which is what the tree goes on showing.
  const client = await deps.ensureClient();
  let loaded = false;
  try {
    ({ success: loaded } = await client.loadFile({ fileName: pkgFile }));
  } catch (err) {
    log.warn("moWatcher", `reload of ${pkgFile} threw: ${asMessage(err)}`);
  }

  const scopes = new Set<string | null>();
  for (const name of names) {
    scopes.add(name);
    scopes.add(scopeOf(name));
  }
  for (const scope of scopes) deps.libraryTree.childrenChanged(scope);
  for (const name of names) deps.sourceProvider.notifySourceChanged(name);

  if (!loaded) {
    // pkgFile can vanish between the busy check above and here — a directory
    // delete racing this reorder — in which case it's a delete, not a failed
    // reorder, and handleMoDelete/handleOrderDelete reconcile it instead.
    if (!(await deps.fileExists(pkgFile))) return;
    log.warn("moWatcher", `reloading ${pkgFile} after a reorder failed`);
    void vscode.window.showWarningMessage(
      `Modelica: ${path.basename(describedPath)} could not be applied — ` +
        `${names.join(", ")} still has the order OMC loaded before. Edit and ` +
        `save ${path.basename(pkgFile)} to reload it.`,
    );
  }
}

/**
 * React to a `package.order` file appearing or changing on disk: resolve the
 * owning package from the sibling `package.mo` (already keyed in the
 * path→class index) and re-derive its child order via {@link reorderPackage}.
 */
export async function handleOrderChange(
  deps: MoWatcherDeps,
  orderFsPath: string,
): Promise<void> {
  let text: string;
  try {
    text = await deps.readFile(orderFsPath);
  } catch {
    // Raced with a delete, or unreadable — nothing to react to.
    return;
  }
  if (deps.guard.claim(orderFsPath, text)) return;
  await reorderPackage(deps, orderOwner(orderFsPath), orderFsPath);
}

/**
 * React to a `package.order` file being deleted — the package reverts to
 * OMC's default child order, which still needs a fresh `loadFile` to take.
 * There's no text left to run through the self-write guard, but a delete
 * only ever removes explicit ordering, so there's nothing of ours to skip.
 *
 * Deleting a whole package directory fires this alongside a `.mo` delete for
 * the same `package.mo`, in no guaranteed order. If the owning `package.mo`
 * is already gone, the package itself was removed — `handleMoDelete` owns
 * that case, and reordering a file that no longer exists would only produce
 * a spurious "reload it" warning for what is really just a normal delete.
 */
export async function handleOrderDelete(
  deps: MoWatcherDeps,
  orderFsPath: string,
): Promise<void> {
  const pkgFile = orderOwner(orderFsPath);
  if (!(await deps.fileExists(pkgFile))) return;
  await reorderPackage(deps, pkgFile, orderFsPath);
}

/**
 * React to a `.mo` file being deleted. The file is gone, so its classes are
 * resolved from the index built as files loaded; each is unloaded from OMC and
 * its enclosing scope re-listed. A rename arrives as delete + create.
 */
export async function handleMoDelete(
  deps: MoWatcherDeps,
  fsPath: string,
): Promise<void> {
  const names = deps.index.get(fsPath);
  if (names === undefined || names.length === 0) {
    log.warn("moWatcher", `deleted ${fsPath} declared no indexed classes`);
    return;
  }
  if (deps.isBusy(fsPath, names)) {
    warnBusy(fsPath, names);
    return;
  }

  const client = await deps.ensureClient();
  for (const name of names) {
    await client.deleteClass({ typeName: name });
    deps.sourceProvider.notifySourceChanged(name);
  }
  deps.index.delete(fsPath);

  const scopes = new Set<string | null>();
  for (const name of names) scopes.add(scopeOf(name));
  for (const scope of scopes) deps.libraryTree.childrenChanged(scope);
}

/**
 * True when any class in `classNames` is open and dirty — as a custom editor
 * over its `modelica-source:` URI, or as a plain text editor over the file on
 * disk. Reloading OMC under such a buffer would discard the unsaved edit.
 */
export function isDeclaredClassBusy(
  fsPath: string,
  classNames: string[],
): boolean {
  const sourceUris = new Set(classNames.map((n) => sourceUriFor(n).toString()));
  const diskUri = vscode.Uri.file(fsPath).toString();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (!tab.isDirty) continue;
      const input = tab.input;
      if (
        input instanceof vscode.TabInputCustom &&
        input.uri.scheme === MODELICA_SOURCE_SCHEME &&
        sourceUris.has(input.uri.toString())
      ) {
        return true;
      }
      if (
        input instanceof vscode.TabInputText &&
        input.uri.toString() === diskUri
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Populate the path→class index for the `.mo` files already on disk, so a
 * later delete of a pre-existing file can resolve its classes. Best-effort:
 * a file that fails to parse is skipped.
 */
export async function seedPathClassIndex(
  client: Pick<WatcherOmcClient, "parseFile">,
  files: string[],
  index: PathClassIndex,
): Promise<void> {
  for (const fsPath of files) {
    try {
      const { classNames } = await client.parseFile({ fileName: fsPath });
      if (classNames.length > 0) index.set(fsPath, classNames);
    } catch (err) {
      log.warn(
        "moWatcher",
        `seed parseFile ${fsPath} failed: ${asMessage(err)}`,
      );
    }
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Register the workspace `.mo` watcher and kick off index seeding. Returns a
 * disposable that tears down the watcher and its handler subscriptions.
 */
export function registerMoFileWatcher(deps: {
  ensureClient: () => Promise<WatcherOmcClient>;
  libraryTree: LibraryWebviewProvider;
  sourceProvider: ModelicaSourceProvider;
  guard: SelfWriteGuard;
}): vscode.Disposable {
  const index = createPathClassIndex();
  const watcherDeps: MoWatcherDeps = {
    ensureClient: deps.ensureClient,
    libraryTree: deps.libraryTree,
    sourceProvider: deps.sourceProvider,
    guard: deps.guard,
    index,
    readFile: (fsPath) => fsp.readFile(fsPath, "utf8"),
    fileExists: pathExists,
    isBusy: isDeclaredClassBusy,
  };

  // Seed before reacting: a delete resolves its classes from the index, so an
  // event that lands mid-seed must wait or it would no-op a real deletion.
  const seedReady = seedWorkspaceIndex(deps.ensureClient, index);

  // Serialize per path so overlapping events (a rename is delete+create; rapid
  // saves) can't interleave their index writes and leave it out of sync.
  const inFlight = new Map<string, Promise<void>>();
  const run = (fsPath: string, fn: () => Promise<void>): void => {
    const key = path.resolve(fsPath);
    const prior = inFlight.get(key) ?? Promise.resolve();
    const next = prior
      .then(() => seedReady)
      .then(fn)
      .catch((err) =>
        log.warn("moWatcher", `handling ${fsPath} failed: ${asMessage(err)}`),
      );
    inFlight.set(key, next);
    void next.finally(() => {
      if (inFlight.get(key) === next) inFlight.delete(key);
    });
  };

  const watcher = vscode.workspace.createFileSystemWatcher("**/*.mo");
  const orderWatcher =
    vscode.workspace.createFileSystemWatcher("**/package.order");
  const subs = [
    watcher,
    watcher.onDidChange((uri) =>
      run(uri.fsPath, () => handleMoChange(watcherDeps, uri.fsPath)),
    ),
    watcher.onDidCreate((uri) =>
      run(uri.fsPath, () => handleMoChange(watcherDeps, uri.fsPath)),
    ),
    watcher.onDidDelete((uri) =>
      run(uri.fsPath, () => handleMoDelete(watcherDeps, uri.fsPath)),
    ),
    orderWatcher,
    // Keyed by the owning package.mo, not the package.order path itself, so a
    // reorder and a `.mo` event for that same package.mo can't run
    // concurrently. A member file's own event keys on its own path and can
    // still interleave with the reorder's reload.
    orderWatcher.onDidChange((uri) =>
      run(orderOwner(uri.fsPath), () =>
        handleOrderChange(watcherDeps, uri.fsPath),
      ),
    ),
    orderWatcher.onDidCreate((uri) =>
      run(orderOwner(uri.fsPath), () =>
        handleOrderChange(watcherDeps, uri.fsPath),
      ),
    ),
    orderWatcher.onDidDelete((uri) =>
      run(orderOwner(uri.fsPath), () =>
        handleOrderDelete(watcherDeps, uri.fsPath),
      ),
    ),
  ];

  return vscode.Disposable.from(...subs);
}

async function seedWorkspaceIndex(
  ensureClient: () => Promise<WatcherOmcClient>,
  index: PathClassIndex,
): Promise<void> {
  try {
    const uris = await vscode.workspace.findFiles("**/*.mo");
    if (uris.length === 0) return;
    const client = await ensureClient();
    await seedPathClassIndex(
      client,
      uris.map((u) => u.fsPath),
      index,
    );
  } catch (err) {
    log.warn("moWatcher", `index seed failed: ${asMessage(err)}`);
  }
}
