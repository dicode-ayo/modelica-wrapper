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
  fileClassNames,
  moreThanOne,
  type FileParseClient,
} from "./single-entity-file.js";
import { deriveEntryPoints } from "./workspace-scan.js";

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
 * An entry file left unloaded because another entry file in the same sweep
 * declares its class and loaded. Every workspace folder shares one OMC
 * session, so loading both would leave one silently replacing the other.
 */
export interface NameCollision {
  className: string;
  keptFileName: string;
  refusedFileName: string;
}

/** What one {@link loadEntryFilesAndRefresh} sweep refused to load, and why. */
export interface AutoLoadRefusals {
  skipped: SkippedEntryFile[];
  collisions: NameCollision[];
}

const MAX_TOAST_COLLISIONS = 3;

/** Batch notification for every name collision one sweep refused. */
export function nameCollisionToast(collisions: NameCollision[]): string {
  const shown = collisions
    .slice(0, MAX_TOAST_COLLISIONS)
    .map(
      (c) =>
        `${c.refusedFileName} was skipped: ${c.className} is already ` +
        `loaded from ${c.keptFileName}`,
    );
  const hidden = collisions.length - shown.length;
  if (hidden > 0) shown.push(`and ${hidden} more`);
  return (
    `Modelica: ${shown.join("; ")}. Entry files share one OpenModelica ` +
    `session, so only the copy of each class that loaded was kept.`
  );
}

/**
 * Load each entry file, then invoke `refresh` a single time — but only if at
 * least one file loaded. One refresh (not one per file) keeps the post-startup
 * rebuild to a single, mutex-serialized OMC fetch instead of a concurrent
 * batch; skipping it when nothing loaded lets a genuinely empty workspace keep
 * its "Load Library" state.
 *
 * Of several entry files declaring the same class, only the first in `files`
 * is loaded; if it fails to load, the next one is tried in its place.
 *
 * Returns the entry files refused for declaring several top-level classes or
 * a class another entry file loaded, so the caller can report each batch in
 * one message.
 */
export async function loadEntryFilesAndRefresh(
  client: AutoLoadClient,
  files: readonly string[],
  refresh: () => void,
): Promise<AutoLoadRefusals> {
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
  // `deriveEntryPoints` walks roots in workspace-folder order, so the earlier
  // folder's copy heads a contested name; within one folder the order is the
  // scanner's.
  const candidatesByName = new Map<string, string[]>();
  const eligible: string[] = [];
  // Nested workspace folders derive the same entry file once per folder.
  for (const fileName of new Set(files)) {
    const classNames = await fileClassNames(client, fileName);
    if (classNames === undefined) {
      eligible.push(fileName);
      continue;
    }
    const multiple = moreThanOne(classNames);
    if (multiple) {
      log.warn(
        "autoLoad",
        `skipping ${fileName}: declares ${multiple.join(", ")}`,
      );
      skipped.push({ fileName, classNames: multiple });
      continue;
    }
    const [className] = classNames;
    if (className === undefined) {
      eligible.push(fileName);
      continue;
    }
    const candidates = candidatesByName.get(className);
    if (candidates === undefined) {
      candidatesByName.set(className, [fileName]);
      eligible.push(fileName);
    } else {
      candidates.push(fileName);
    }
  }
  // The screen lets a file OMC could not parse through to the load, but
  // `parseFile` has already deposited that parse error; without a drain the
  // first failing load's `getErrorString` reports it as its own reason.
  await client.getErrorString();

  const loaded = new Set<string>();
  let failed: string[] = [];
  // A `within <Parent>;` child in a standalone file fails to insert when its
  // parent package file hasn't loaded yet (discovery order is arbitrary — a
  // child can sort before its parent). Retry the still-failed set pass by pass
  // as long as each pass loads at least one; a pass that loads a parent unblocks
  // its children, which unblocks grandchildren, until no pass makes progress.
  const settle = async (fresh: readonly string[]): Promise<void> => {
    let progressed = false;
    for (const fileName of fresh) {
      if (await tryLoad(fileName)) {
        loaded.add(fileName);
        progressed = true;
      } else {
        failed.push(fileName);
      }
    }
    while (failed.length > 0 && progressed) {
      const stillFailed: string[] = [];
      progressed = false;
      for (const fileName of failed) {
        if (await tryLoad(fileName)) {
          loaded.add(fileName);
          progressed = true;
        } else {
          stillFailed.push(fileName);
        }
      }
      failed = stillFailed;
    }
  };

  const headIndex = new Map<string, number>();
  let fresh: string[] = eligible;
  while (fresh.length > 0) {
    await settle(fresh);
    fresh = [];
    const failedSet = new Set(failed);
    for (const [className, candidates] of candidatesByName) {
      const i = headIndex.get(className) ?? 0;
      const head = candidates[i];
      if (head === undefined || !failedSet.has(head)) continue;
      failed = failed.filter((f) => f !== head);
      headIndex.set(className, i + 1);
      const next = candidates[i + 1];
      if (next !== undefined) fresh.push(next);
    }
  }

  const collisions: NameCollision[] = [];
  for (const [className, candidates] of candidatesByName) {
    const keptFileName = candidates.find((f) => loaded.has(f));
    if (keptFileName === undefined) continue;
    for (const refusedFileName of candidates) {
      if (refusedFileName === keptFileName) continue;
      log.warn(
        "autoLoad",
        `skipping ${refusedFileName}: ${className} is already loaded from ${keptFileName}`,
      );
      collisions.push({ className, keptFileName, refusedFileName });
    }
  }

  if (loaded.size > 0) {
    refresh();
  }
  return { skipped, collisions };
}

/** What {@link autoLoadWorkspace} needs to discover, load, and report on entry files. */
export interface WorkspaceAutoloadDeps {
  /** Absolute fs paths of the workspace folders to scan. */
  folders: () => readonly string[];
  ensureClient: () => Promise<AutoLoadClient>;
  /** Told once, after every load settles — see {@link loadEntryFilesAndRefresh}. */
  refresh: () => void;
  onSkipped: (skipped: SkippedEntryFile[]) => void;
  onCollisions: (collisions: NameCollision[]) => void;
  /**
   * A flat list of every `.mo` path in the workspace, shared with the
   * mo-file-watcher's own `sessionReplaced` reseed so `:reset` triggers one
   * recursive scan instead of two.
   */
  scanMoFiles: () => Promise<readonly string[]>;
}

/**
 * Discover Modelica entry points from `deps.scanMoFiles`'s flat file list and
 * load them into OMC, refreshing the sidebar once. Run at activation
 * (`run()`) and again on every `:reset` — see {@link registerWorkspaceAutoload}.
 */
export async function autoLoadWorkspace(
  deps: WorkspaceAutoloadDeps,
): Promise<void> {
  try {
    const folders = deps.folders();
    if (folders.length === 0) return;
    const files = deriveEntryPoints(await deps.scanMoFiles(), folders);
    if (files.length === 0) return;
    const c = await deps.ensureClient();
    // One refresh after all loads settle — not per file, which would pile
    // concurrent OMC fetches onto the single ZeroMQ socket during startup. The
    // webview tree's own mount fetch is serialized with this one through the
    // client, so they can't overlap into a busy-socket send.
    const { skipped, collisions } = await loadEntryFilesAndRefresh(
      c,
      files,
      deps.refresh,
    );
    if (skipped.length > 0) deps.onSkipped(skipped);
    if (collisions.length > 0) deps.onCollisions(collisions);
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
  const sub = invalidation.registerSessionReplaced(run);
  return { run, dispose: () => sub.dispose() };
}
