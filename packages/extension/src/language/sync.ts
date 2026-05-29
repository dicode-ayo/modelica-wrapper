/**
 * Buffer ↔ OMC load policy.
 *
 *   - Load on first touch.
 *   - {@link OmcSync.invalidate} clears the loaded flag (wire to both
 *     `onDidSaveTextDocument` and `onDidCloseTextDocument`).
 *   - Between saves, resolution reflects the last saved text — not the dirty
 *     buffer. See `docs/language-features-design.md` → "Buffer ↔ OMC sync".
 */

import { log } from "../logger.js";

export interface SyncClient {
  loadFile(input: { fileName: string }): Promise<{ success: boolean }>;
}

export interface OmcSyncOptions {
  /**
   * Canonicalize a file path before using it as a cache key. Defaults to
   * {@link defaultNormalizeKey} (case-folds on Windows/macOS to absorb VSCode's
   * inconsistent fsPath casing across events).
   */
  normalizeKey?: (filePath: string) => string;
}

/** Case-folds on case-insensitive hosts (win32/darwin); identity elsewhere. */
export const defaultNormalizeKey: (filePath: string) => string =
  process.platform === "win32" || process.platform === "darwin"
    ? (p) => p.toLowerCase()
    : (p) => p;

export class OmcSync {
  private readonly loaded = new Set<string>();
  private readonly inFlight = new Map<string, Promise<boolean>>();
  /**
   * Per-path counter bumped on every {@link invalidate}. {@link load} snapshots
   * it at issue time; a mismatch on resolution means a save/close fired
   * mid-flight, so the result is discarded.
   */
  private readonly generation = new Map<string, number>();
  private readonly normalizeKey: (filePath: string) => string;

  constructor(private readonly client: SyncClient, options: OmcSyncOptions = {}) {
    this.normalizeKey = options.normalizeKey ?? defaultNormalizeKey;
  }

  /**
   * Load `filePath` into OMC on first touch. No-op when already loaded or a
   * load is in flight. Returns `false` on `loadFile` failure (caller retries
   * on the next touch); does not throw.
   */
  async ensureLoaded(filePath: string): Promise<boolean> {
    const key = this.normalizeKey(filePath);
    if (this.loaded.has(key)) return true;

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
    const key = this.normalizeKey(filePath);
    this.loaded.delete(key);
    this.inFlight.delete(key);
    this.generation.set(key, (this.generation.get(key) ?? 0) + 1);
  }

  isLoaded(filePath: string): boolean {
    return this.loaded.has(this.normalizeKey(filePath));
  }

  private async load(filePath: string, key: string): Promise<boolean> {
    const snapshot = this.generation.get(key) ?? 0;
    try {
      const { success } = await this.client.loadFile({ fileName: filePath });
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
