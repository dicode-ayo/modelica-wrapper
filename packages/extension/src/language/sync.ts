/**
 * Buffer ↔ OMC synchronisation — the v1 load policy.
 *
 * OMC answers about *loaded* models, but the editor buffer drifts on every
 * keystroke. Re-loading on every keystroke would be both slow (a synchronous
 * OMC round-trip) and wrong (it would surface errors for half-typed code). The
 * v1 policy (see `docs/language-features-design.md` → "Buffer ↔ OMC sync") is
 * therefore deliberately coarse:
 *
 *   - **Load on first touch.** The first resolution against a file `loadFile`s
 *     it into OMC so the symbol table knows its classes.
 *   - **Re-load on save.** {@link OmcSync.markSaved} clears the loaded flag so
 *     the next touch re-`loadFile`s the now-current on-disk text.
 *   - **Staleness between saves is accepted and documented.** Resolution
 *     reflects the *last saved* state of the file, not the live (dirty) buffer.
 *     This is fine for go-to-definition / hover; completion of a just-typed,
 *     unsaved name is a known limitation. A live-buffer story (`loadString` of
 *     the dirty buffer behind a debounce) is a follow-up, not v1.
 *
 * The OMC dependency is the structural {@link SyncClient} (the typed `loadFile`
 * wrapper), injected so the policy is unit-testable with a plain mock — no live
 * OMC. This mirrors `diagram/omc-snapshot.ts`.
 */

import { log } from "../logger.js";

/** The single OMC call this module makes — the typed `loadFile` wrapper. */
export interface SyncClient {
  loadFile(input: { fileName: string }): Promise<{ success: boolean }>;
}

/**
 * Tracks which files have been loaded into OMC and enforces the load-on-open /
 * load-on-save policy. One instance is shared across the language providers.
 *
 * Concurrency: {@link ensureLoaded} de-dupes concurrent first-touch loads of
 * the same file by caching the in-flight promise, so two near-simultaneous
 * resolutions don't issue two `loadFile`s.
 */
export class OmcSync {
  /** Resolved set of file paths currently considered loaded in OMC. */
  private readonly loaded = new Set<string>();
  /** In-flight `loadFile` promises, keyed by file path, to de-dupe touches. */
  private readonly inFlight = new Map<string, Promise<boolean>>();
  /**
   * Per-path generation counter, bumped by {@link markSaved} / {@link invalidate}.
   * Each {@link load} snapshots the current generation when it starts; if the
   * snapshot no longer matches when the load resolves, the file's text was
   * invalidated mid-flight and the result is discarded (not added to `loaded`).
   * Closes the save-during-load race that would otherwise keep the buffer
   * stuck on pre-save text until the next save.
   */
  private readonly generation = new Map<string, number>();

  constructor(private readonly client: SyncClient) {}

  /**
   * Ensure `filePath` is loaded into OMC, loading it on first touch. Subsequent
   * calls are a no-op until {@link markSaved} or {@link invalidate} clears the
   * flag. Returns whether the file is loaded (true if already loaded or the
   * load succeeded).
   *
   * A failed `loadFile` is logged and leaves the file *unloaded* so a later
   * touch retries; it does not throw, so resolution can degrade gracefully.
   */
  async ensureLoaded(filePath: string): Promise<boolean> {
    if (this.loaded.has(filePath)) return true;

    const pending = this.inFlight.get(filePath);
    if (pending) return pending;

    const promise = this.load(filePath);
    this.inFlight.set(filePath, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(filePath);
    }
  }

  /**
   * Mark a file as saved: drop its loaded flag so the next {@link ensureLoaded}
   * re-`loadFile`s the current on-disk text. Wire this to
   * `workspace.onDidSaveTextDocument`.
   *
   * Bumps the per-path generation counter, so an in-flight {@link load} whose
   * snapshot now differs will discard its result instead of re-adding the path
   * to `loaded` against pre-save text.
   */
  markSaved(filePath: string): void {
    this.loaded.delete(filePath);
    this.bumpGeneration(filePath);
  }

  /**
   * Forget a file entirely (e.g. on close). Same semantics as {@link markSaved}
   * for the load flag + generation, named separately so call sites read
   * intentionally.
   */
  invalidate(filePath: string): void {
    this.loaded.delete(filePath);
    this.bumpGeneration(filePath);
  }

  /** True if `filePath` is currently considered loaded (test/inspection aid). */
  isLoaded(filePath: string): boolean {
    return this.loaded.has(filePath);
  }

  private bumpGeneration(filePath: string): void {
    this.generation.set(filePath, (this.generation.get(filePath) ?? 0) + 1);
  }

  private async load(filePath: string): Promise<boolean> {
    const snapshot = this.generation.get(filePath) ?? 0;
    try {
      const { success } = await this.client.loadFile({ fileName: filePath });
      // A save/invalidate fired mid-flight — the load read pre-save text, so
      // discard the result. The next `ensureLoaded` will re-issue a fresh load.
      if (snapshot !== (this.generation.get(filePath) ?? 0)) {
        return false;
      }
      if (success) {
        this.loaded.add(filePath);
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
