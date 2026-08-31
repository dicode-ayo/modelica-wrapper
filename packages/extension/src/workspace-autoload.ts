/**
 * Workspace auto-load: load discovered entry files into OMC on activation, then
 * refresh the sidebar exactly once. Also re-run on `:reset`, serialized
 * against the activation sweep on the same queue — see
 * {@link registerWorkspaceAutoload}.
 */

import type * as vscode from "vscode";

import { errorDetail } from "./error-detail.js";
import type { ClassInvalidationRegistry } from "./invalidation.js";
import { log } from "./logger.js";
import { SessionQueue } from "./session-queue.js";
import {
  multipleTopLevelClasses,
  type FileParseClient,
} from "./single-entity-file.js";
import { deriveEntryPoints, discoverEntryPoints } from "./workspace-scan.js";

/** OMC surface the auto-loader calls. `OmcClient` satisfies it structurally. */
export interface AutoLoadClient extends FileParseClient {
  loadFile(input: { fileName: string }): Promise<{ success: boolean }>;
  getErrorString(): Promise<{ errorString: string }>;
}

/** An entry file left unloaded because it holds more than one entity. */
export interface SkippedEntryFile {
  fileName: string;
  classNames: string[];
}

/**
 * Load each entry file, then invoke `refresh` a single time — but only if at
 * least one file loaded. One refresh (not one per file) keeps the post-startup
 * rebuild to a single, mutex-serialized OMC fetch instead of a concurrent
 * batch; skipping it when nothing loaded lets a genuinely empty workspace keep
 * its "Load Library" state.
 *
 * Returns the entry files refused for declaring several top-level classes, so
 * the caller can report the whole batch in one message.
 */
export async function loadEntryFilesAndRefresh(
  client: AutoLoadClient,
  files: readonly string[],
  refresh: () => void,
): Promise<SkippedEntryFile[]> {
  const tryLoad = async (fileName: string): Promise<boolean> => {
    try {
      const { success } = await client.loadFile({ fileName });
      if (success) {
        log.info("autoLoad", `loaded ${fileName}`);
        return true;
      }
      const { errorString } = await client.getErrorString();
      log.warn("autoLoad", `loadFile failed: ${fileName}: ${errorString}`);
      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("autoLoad", `loadFile threw for ${fileName}: ${message}`);
      return false;
    }
  };

  // Screen before the first pass, so a refused file stays out of the retry
  // loop below as well.
  const skipped: SkippedEntryFile[] = [];
  const eligible: string[] = [];
  for (const fileName of files) {
    const classNames = await multipleTopLevelClasses(client, fileName);
    if (classNames) {
      log.warn(
        "autoLoad",
        `skipping ${fileName}: declares ${classNames.join(", ")}`,
      );
      skipped.push({ fileName, classNames });
    } else {
      eligible.push(fileName);
    }
  }
  // The screen lets a file OMC could not parse through to the load, but
  // `parseFile` has already deposited that parse error; without a drain the
  // first failing load's `getErrorString` reports it as its own reason.
  await client.getErrorString();

  let loadedAny = false;
  let failed: string[] = [];
  for (const fileName of eligible) {
    if (await tryLoad(fileName)) loadedAny = true;
    else failed.push(fileName);
  }
  // A `within <Parent>;` child in a standalone file fails to insert when its
  // parent package file hasn't loaded yet (discovery order is arbitrary — a
  // child can sort before its parent). Retry the still-failed set pass by pass
  // as long as each pass loads at least one; a pass that loads a parent unblocks
  // its children, which unblocks grandchildren, until no pass makes progress.
  while (failed.length > 0 && loadedAny) {
    const stillFailed: string[] = [];
    let progressed = false;
    for (const fileName of failed) {
      if (await tryLoad(fileName)) progressed = true;
      else stillFailed.push(fileName);
    }
    failed = stillFailed;
    if (!progressed) break;
  }
  if (loadedAny) {
    refresh();
  }
  return skipped;
}

/** What {@link autoLoadWorkspace} needs to discover, load, and report on entry files. */
export interface WorkspaceAutoloadDeps {
  /** Absolute fs paths of the workspace folders to scan. */
  folders: () => readonly string[];
  ensureClient: () => Promise<AutoLoadClient>;
  /** Told once, after every load settles — see {@link loadEntryFilesAndRefresh}. */
  refresh: () => void;
  onSkipped: (skipped: SkippedEntryFile[]) => void;
  /**
   * A flat list of every `.mo` path in the workspace, shared with the
   * mo-file-watcher's own `sessionReplaced` reseed so `:reset` triggers one
   * recursive scan instead of two. Used only for the `:reset` path — the
   * activation sweep has no shared scan to reuse yet, since nothing has asked
   * for one before activation, so it keeps `discoverEntryPoints`'s own walk.
   * Omitted, {@link registerWorkspaceAutoload}'s `:reset` listener falls back
   * to that same walk.
   */
  scanMoFiles?: () => Promise<readonly string[]>;
}

/** The ensureClient+load+refresh tail shared by every entry-point discovery strategy. */
async function loadDiscoveredFiles(
  deps: WorkspaceAutoloadDeps,
  files: readonly string[],
): Promise<void> {
  if (files.length === 0) return;
  const c = await deps.ensureClient();
  // One refresh after all loads settle — not per file, which would pile
  // concurrent OMC fetches onto the single ZeroMQ socket during startup. The
  // webview tree's own mount fetch is serialized with this one through the
  // client, so they can't overlap into a busy-socket send.
  const skipped = await loadEntryFilesAndRefresh(c, [...files], deps.refresh);
  if (skipped.length > 0) deps.onSkipped(skipped);
}

/**
 * Discover Modelica entry points across the current workspace folders and
 * load them into OMC, refreshing the sidebar once. Run directly by
 * {@link registerWorkspaceAutoload} for the activation sweep, and as the
 * `:reset` fallback when `deps.scanMoFiles` is absent.
 */
export async function autoLoadWorkspace(
  deps: WorkspaceAutoloadDeps,
): Promise<void> {
  try {
    const folders = deps.folders();
    if (folders.length === 0) return;
    const files = await discoverEntryPoints([...folders]);
    await loadDiscoveredFiles(deps, files);
  } catch (err) {
    log.warn("autoLoad", `workspace autoload failed: ${errorDetail(err)}`);
  }
}

/**
 * The `:reset` counterpart of {@link autoLoadWorkspace}: derives entry points
 * from `deps.scanMoFiles`'s already-known flat file list instead of walking
 * disk again, so a `:reset` shares its scan with the mo-file-watcher's own
 * reseed rather than duplicating it.
 */
async function autoLoadWorkspaceOnReset(
  deps: WorkspaceAutoloadDeps,
): Promise<void> {
  if (deps.scanMoFiles === undefined) {
    await autoLoadWorkspace(deps);
    return;
  }
  try {
    const folders = deps.folders();
    if (folders.length === 0) return;
    const allMoFiles = await deps.scanMoFiles();
    const files = deriveEntryPoints(allMoFiles, folders);
    await loadDiscoveredFiles(deps, files);
  } catch (err) {
    log.warn("autoLoad", `workspace autoload failed: ${errorDetail(err)}`);
  }
}

/** Handle returned by {@link registerWorkspaceAutoload}. `run()` starts a
 *  sweep, queued behind any sweep already in flight; the handle is itself the
 *  `vscode.Disposable` that stops the `:reset` listener. */
export interface WorkspaceAutoload extends vscode.Disposable {
  run(): void;
}

/**
 * Wire up {@link autoLoadWorkspace} to run once, on demand (`run()`, called
 * at activation), and again on every `:reset`. OMC's AST starts empty after a
 * reset and nothing else re-populates it into OMC: the mo-file-watcher's own
 * `sessionReplaced` reseed only rebuilds the local path→class index via
 * `parseFile`, it never calls `loadFile`. Without this, the library
 * sidebar's post-reset reload (`library-webview-provider.ts`'s own
 * `sessionReplaced` listener) just reflects an OMC session autoload never
 * ran against — an empty listing, not the workspace's real classes.
 *
 * Both `run()` and the `:reset` listener chain onto one queue rather than
 * firing standalone, so an activation sweep still in flight when a `:reset`
 * lands — or two `:reset`s close together — serialize instead of launching
 * overlapping discover+load sweeps against the same client.
 */
export function registerWorkspaceAutoload(
  invalidation: ClassInvalidationRegistry,
  deps: WorkspaceAutoloadDeps,
): WorkspaceAutoload {
  const queue = new SessionQueue();
  const run = (): void => {
    queue.enqueue(() => autoLoadWorkspace(deps));
  };
  const sub = invalidation.registerSessionReplaced(() => {
    queue.enqueue(() => autoLoadWorkspaceOnReset(deps));
  });
  return { run, dispose: () => sub.dispose() };
}
