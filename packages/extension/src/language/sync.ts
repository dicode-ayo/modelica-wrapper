/**
 * Buffer ↔ OMC load policy.
 *
 *   - Load on first touch.
 *   - {@link OmcSync.invalidate} clears the loaded flag (wire to both
 *     `onDidSaveTextDocument` and `onDidCloseTextDocument`).
 *   - A file with a dirty buffer open is not loaded on first touch: the load
 *     would revert OMC to the on-disk text under the edit.
 *   - A file the session's class claims refuse is not loaded: it would
 *     replace another file's copy of the same class.
 *   - Once loaded, and between saves, resolution reflects the last saved text
 *     — not the dirty buffer. See `docs/language-features-design.md` → "Buffer ↔ OMC sync".
 */

import { errorDetail } from "../error-detail.js";
import { defaultNormalizeKey } from "../fs-util.js";
import { log } from "../logger.js";
import { moreThanOne, type FileParseClient } from "../single-entity-file.js";
import {
  nameCollisionMessage,
  type NameCollision,
  type TopLevelClaims,
} from "../top-level-claims.js";

export interface SyncClient extends FileParseClient {
  loadFile(input: { fileName: string }): Promise<{ success: boolean }>;
}

export interface OmcSyncOptions {
  /**
   * Canonicalize a file path before using it as a cache key. Defaults to
   * {@link defaultNormalizeKey} (case-folds on Windows/macOS to absorb VSCode's
   * inconsistent fsPath casing across events).
   */
  normalizeKey?: (filePath: string) => string;
  /**
   * Called once per path refused for declaring several top-level classes.
   * Keeps the notification out of this module, which stays host-free.
   */
  onMultiEntity?: (filePath: string, classNames: string[]) => void;
  /**
   * Waited on before each load, consulted and reserved before `loadFile`,
   * and told of each load that succeeds.
   */
  claims?: TopLevelClaims;
  /**
   * Called for a path {@link claims} refused, unless another loader already
   * reported that path.
   */
  onCollision?: (collision: NameCollision) => void;
  /**
   * True when a dirty editor holds unsaved text for one of `classNames`, the
   * top-level classes `filePath` declares. `loadFile` would replace OMC's AST
   * with the on-disk text and discard that edit, so a busy file is left
   * unloaded and retried on the next touch. Synchronous so it can run
   * immediately before `loadFile`, after the parse's await.
   */
  isBusy?: (filePath: string, classNames: string[]) => boolean;
}

export class OmcSync {
  private readonly loaded = new Set<string>();
  private readonly inFlight = new Map<string, Promise<boolean>>();
  /**
   * Per-path counter bumped on every {@link invalidate}. {@link load} snapshots
   * it at issue time; a mismatch on resolution means a save/close fired
   * mid-flight, so the result is discarded.
   */
  private readonly generation = new Map<string, number>();
  /**
   * Paths refused for declaring several top-level classes or a class another
   * file supplies. Remembered so a touch-per-keystroke doesn't re-`parseFile`
   * a file that cannot load, and so each refusal is reported once.
   */
  private readonly refused = new Set<string>();
  private readonly normalizeKey: (filePath: string) => string;
  private readonly isBusy: (filePath: string, classNames: string[]) => boolean;
  private readonly onMultiEntity: (
    filePath: string,
    classNames: string[],
  ) => void;
  private readonly claims: TopLevelClaims | undefined;
  private readonly onCollision: (collision: NameCollision) => void;

  constructor(
    private readonly client: SyncClient,
    options: OmcSyncOptions = {},
  ) {
    this.normalizeKey = options.normalizeKey ?? defaultNormalizeKey;
    this.onMultiEntity = options.onMultiEntity ?? (() => {});
    this.isBusy = options.isBusy ?? (() => false);
    this.claims = options.claims;
    this.onCollision = options.onCollision ?? (() => {});
  }

  /**
   * Load `filePath` into OMC on first touch. No-op when already loaded or a
   * load is in flight. Returns `false` on `loadFile` failure (caller retries
   * on the next touch); does not throw.
   */
  async ensureLoaded(filePath: string): Promise<boolean> {
    const key = this.normalizeKey(filePath);
    if (this.loaded.has(key)) return true;
    if (this.refused.has(key)) return false;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const promise = this.load(filePath, key);
    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      // Don't wipe a fresh entry that `invalidate` swapped in mid-flight.
      if (this.inFlight.get(key) === promise) {
        this.inFlight.delete(key);
      }
    }
  }

  /**
   * Forget the loaded state of `filePath`: drop the flag, evict any in-flight
   * load, and bump the generation so the evicted load discards its result.
   */
  invalidate(filePath: string): void {
    this.invalidateKey(this.normalizeKey(filePath));
  }

  /** {@link invalidate}'s body, for a key already run through {@link normalizeKey}. */
  private invalidateKey(key: string): void {
    this.loaded.delete(key);
    this.inFlight.delete(key);
    // A save that splits the file out into one class each makes it loadable,
    // so the refusal must not outlive the text it was based on.
    this.refused.delete(key);
    this.generation.set(key, (this.generation.get(key) ?? 0) + 1);
  }

  isLoaded(filePath: string): boolean {
    return this.loaded.has(this.normalizeKey(filePath));
  }

  /**
   * Forget every load state this instance tracks: the OMC session those
   * "loaded"/"in-flight"/"refused" facts describe is gone (`:reset`).
   * The keys are already normalized and {@link OmcSyncOptions.normalizeKey}
   * is not required to be idempotent, so they go straight to
   * {@link invalidateKey}.
   */
  resetSession(): void {
    const keys = new Set([
      ...this.loaded,
      ...this.inFlight.keys(),
      ...this.refused,
    ]);
    for (const key of keys) this.invalidateKey(key);
  }

  /** A file OMC cannot parse yields no names: the `loadFile` that follows reports why. */
  private async parseClassNames(filePath: string): Promise<string[]> {
    try {
      return (await this.client.parseFile({ fileName: filePath })).classNames;
    } catch (err) {
      log.warn("language", `parseFile ${filePath} failed: ${errorDetail(err)}`);
      return [];
    }
  }

  private async load(filePath: string, key: string): Promise<boolean> {
    const snapshot = this.generation.get(key) ?? 0;
    try {
      // A load during the workspace sweep would race it for which copy of a
      // class is kept.
      await this.claims?.settled();
      const classNames = await this.parseClassNames(filePath);
      // Invalidated mid-parse — the parse read stale text, discard. Recording
      // the refusal would outlive the text it was based on.
      if (snapshot !== (this.generation.get(key) ?? 0)) {
        return false;
      }
      const several = moreThanOne(classNames);
      if (several) {
        this.refused.add(key);
        this.onMultiEntity(filePath, several);
        return false;
      }
      const collision = this.claims?.refusal(filePath, classNames);
      if (collision !== undefined) {
        this.refused.add(key);
        log.warn("language", nameCollisionMessage(collision));
        if (this.claims?.recordRefusal(collision, classNames)) {
          this.onCollision(collision);
        }
        return false;
      }
      if (this.isBusy(filePath, classNames)) return false;
      const reservation = this.claims?.reserve(filePath, classNames);
      let success = false;
      try {
        ({ success } = await this.client.loadFile({ fileName: filePath }));
      } finally {
        // OMC holds what loaded even when this result is discarded below.
        if (success) reservation?.commit();
        else reservation?.cancel();
      }
      // Invalidated mid-flight — load read stale text, discard.
      if (snapshot !== (this.generation.get(key) ?? 0)) {
        return false;
      }
      if (success) {
        this.loaded.add(key);
        return true;
      }
      log.warn("language", `loadFile reported failure for ${filePath}`);
      return false;
    } catch (err) {
      log.error("language", `loadFile threw for ${filePath}`, err);
      return false;
    }
  }
}
