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
import {
  createTopLevelClaims,
  type NameCollision,
  type TopLevelClaims,
} from "./top-level-claims.js";
import { deriveEntryPoints } from "./workspace-scan.js";

export { nameCollisionToast, type NameCollision } from "./top-level-claims.js";

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

/** What one {@link loadEntryFilesAndRefresh} sweep refused to load, and why. */
export interface AutoLoadRefusals {
  skipped: SkippedEntryFile[];
  collisions: NameCollision[];
}

function logCollision(c: NameCollision): void {
  log.warn(
    "autoLoad",
    `not loading ${c.refusedFileName}: ${c.className} is already loaded from ${c.keptFileName}`,
  );
}

/**
 * Load each entry file, then invoke `refresh` a single time — but only if at
 * least one file loaded. One refresh (not one per file) keeps the post-startup
 * rebuild to a single, mutex-serialized OMC fetch instead of a concurrent
 * batch; skipping it when nothing loaded lets a genuinely empty workspace keep
 * its "Load Library" state.
 *
 * Of several entry files declaring the same class, at most one is loaded: the
 * first in `files` that loads. A later copy is tried only once the earlier
 * copies stall, and those earlier copies keep being retried alongside it.
 *
 * Each load is recorded in `claims`, which also refuses a file a load outside
 * this sweep already supplied, or one reaching into a refused copy's library.
 *
 * Returns the entry files refused for declaring several top-level classes or
 * a class another file loaded, so the caller can report each batch in one
 * message.
 */
export async function loadEntryFilesAndRefresh(
  client: AutoLoadClient,
  files: readonly string[],
  refresh: () => void,
  claims: TopLevelClaims = createTopLevelClaims(),
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
  const classNameByFile = new Map<string, string>();
  const order: string[] = [];
  const active = new Set<string>();
  // Nested workspace folders derive the same entry file once per folder.
  for (const fileName of new Set(files)) {
    const classNames = await fileClassNames(client, fileName);
    const multiple =
      classNames === undefined ? undefined : moreThanOne(classNames);
    if (multiple) {
      log.warn(
        "autoLoad",
        `skipping ${fileName}: declares ${multiple.join(", ")}`,
      );
      skipped.push({ fileName, classNames: multiple });
      continue;
    }
    order.push(fileName);
    // A file OMC can't parse has no name to claim; its load reports the
    // failure.
    const className = classNames?.[0];
    if (className === undefined) {
      active.add(fileName);
      continue;
    }
    classNameByFile.set(fileName, className);
    const candidates = candidatesByName.get(className);
    if (candidates === undefined) {
      candidatesByName.set(className, [fileName]);
      active.add(fileName);
    } else {
      candidates.push(fileName);
    }
  }
  // The screen lets a file OMC could not parse through to the load, but
  // `parseFile` has already deposited that parse error; without a drain the
  // first failing load's `getErrorString` reports it as its own reason.
  await client.getErrorString();

  const loaded = new Set<string>();
  const loadedNames = new Set<string>();
  const collisions: NameCollision[] = [];
  // Index of each contested name's last active candidate.
  const lastActive = new Map<string, number>();
  // A `within <Parent>;` child in a standalone file fails to insert when its
  // parent package file hasn't loaded yet (discovery order is arbitrary — a
  // child can sort before its parent), so the pool is retried pass by pass
  // while each pass loads at least one file. A failed copy stays in the pool
  // after a later copy joins it: it may have failed only for want of a parent
  // that a later copy of another name supplies, and walking in discovery order
  // keeps it ahead of its own later copies.
  for (;;) {
    let progressed = false;
    for (const fileName of order) {
      if (!active.has(fileName)) continue;
      const className = classNameByFile.get(fileName);
      if (className !== undefined && loadedNames.has(className)) {
        active.delete(fileName);
        continue;
      }
      // A load earlier in this pass may be what an earlier copy of this name
      // was missing, so a later copy waits for the next pass to retry it.
      if (
        progressed &&
        className !== undefined &&
        candidatesByName.get(className)?.[0] !== fileName
      ) {
        continue;
      }
      const refusal = claims.refusal(
        fileName,
        className === undefined ? [] : [className],
      );
      if (refusal !== undefined) {
        logCollision(refusal);
        collisions.push(refusal);
        active.delete(fileName);
        continue;
      }
      if (await tryLoad(fileName)) {
        loaded.add(fileName);
        active.delete(fileName);
        progressed = true;
        if (className === undefined) continue;
        loadedNames.add(className);
        claims.recordLoad(fileName, [className]);
        const candidates = candidatesByName.get(className) ?? [];
        for (const later of candidates.slice(
          candidates.indexOf(fileName) + 1,
        )) {
          claims.refuse(later, className);
        }
      }
    }
    if (progressed) continue;
    let added = false;
    for (const [className, candidates] of candidatesByName) {
      if (loadedNames.has(className)) continue;
      const i = (lastActive.get(className) ?? 0) + 1;
      const next = candidates[i];
      if (next === undefined) continue;
      lastActive.set(className, i);
      active.add(next);
      added = true;
    }
    if (!added) break;
  }

  for (const [className, candidates] of candidatesByName) {
    // Copies before the kept one failed on their own; those after it lost to
    // it, whether or not they were tried first.
    const keptIndex = candidates.findIndex((f) => loaded.has(f));
    const keptFileName = candidates[keptIndex];
    if (keptFileName === undefined) continue;
    for (const refusedFileName of candidates.slice(keptIndex + 1)) {
      const collision = { className, keptFileName, refusedFileName };
      logCollision(collision);
      collisions.push(collision);
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
  claims?: TopLevelClaims,
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
      claims,
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
  /**
   * The session's top-level class claims, for every later load and unload to
   * consult. Cleared on `:reset`, before that reset's sweep is queued.
   */
  claims: TopLevelClaims;
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
  const claims = createTopLevelClaims();
  const run = (): void => {
    queue.enqueue(() => autoLoadWorkspace(deps, claims));
  };
  const sub = invalidation.registerSessionReplaced(() => {
    claims.clear();
    run();
  });
  return { run, claims, dispose: () => sub.dispose() };
}
