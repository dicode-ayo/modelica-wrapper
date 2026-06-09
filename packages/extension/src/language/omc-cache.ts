/**
 * Bounded, library-signature-keyed cache for the read-only OMC lookups behind
 * resolution and completion (#100, "Polish + perf").
 *
 * ## Why
 *
 * Go-to-definition, hover, and (especially) completion issue the *same*
 * read-only OMC queries over and over: qualifying a name in a scope
 * (`qualifyPath`), reading a class's location/restriction
 * (`getClassInformation`), listing a type's components and `extends` bases
 * (`getComponents` / `getInheritedClasses`), and the candidate-source lists
 * (`getClassNames` / `searchClassNames` / `getParameterNames` / `isPackage`). A
 * completion keystroke alone fans out to
 * several of these, and the answers are *stable* for a given input as long as
 * the set of loaded models doesn't change. Re-issuing them on every request is
 * the dominant per-request cost the design doc calls out
 * (`docs/language-features-design.md` → "Performance … completion needs …
 * caching of class-name lists keyed by the loaded-library set").
 *
 * ## What's cached
 *
 * The read-only lookups on the completion + hover surfaces
 * ({@link CompletionClient}, a superset of {@link ResolveClient}, plus the two
 * {@link HoverClient} reads `getClassInformation` / `getClassComment`). Mutating
 * / lifecycle calls (`loadFile`, `parseFile`,
 * …) are NOT routed through here — they live on other structural surfaces and
 * must always hit OMC.
 *
 * ## Correctness — the library signature
 *
 * Every cached value is tagged with a *loaded-library signature*: the
 * `[name, version]` pairs from
 * [`getLoadedLibraries`](../../../omc-client/src/api/library/getLoadedLibraries.ts),
 * sorted and joined. When a library is loaded/unloaded the signature changes and
 * the WHOLE cache is dropped, so a stale answer can never survive a change to
 * the loaded set. Fetching the signature itself is an OMC round-trip, so it is
 * memoised for a short {@link SIGNATURE_TTL_MS} window — long enough to cover
 * the burst of lookups in one user gesture, short enough that a library load is
 * picked up promptly. In addition, {@link OmcLookupCache.invalidate} is wired to
 * document-save in `index.ts`: a save re-`loadFile`s the file (its classes may
 * have changed) and clearing the cache then is the conservative, always-correct
 * move rather than trusting the signature to notice an in-place file reload.
 *
 * If `getLoadedLibraries` ever fails we fall back to a sentinel signature and
 * keep serving — a degraded cache (possibly an extra round-trip) is better than
 * throwing out of a provider.
 *
 * ## Bound
 *
 * The entry map is capped at {@link MAX_CACHE_ENTRIES}; on overflow the oldest
 * insertion is evicted (Map preserves insertion order), giving a simple FIFO
 * bound with no unbounded growth on a long session over a large library.
 *
 * ## Shape
 *
 * The cache *is* a {@link CompletionClient}: it wraps a real one and implements
 * the same surface, so call sites swap the raw client for the cached one with no
 * other change. The structural surface keeps it unit-testable with a plain mock
 * (mirrors `resolve.ts` / `sync.ts`).
 */

import { log } from "../logger.js";

import type { CompletionClient } from "./completion/client.js";
import type { HoverClient } from "./hover-provider.js";

/**
 * How long a fetched loaded-library signature is trusted before it is
 * re-queried. Covers the burst of lookups in a single user gesture (a hover, a
 * completion keystroke fanning out to several queries) without a
 * `getLoadedLibraries` round-trip per lookup, while staying short enough that a
 * library load/unload is reflected within a couple of seconds.
 */
export const SIGNATURE_TTL_MS = 2_000;

/**
 * Upper bound on cached lookup entries. A completion-heavy session over a large
 * library (MSL is thousands of classes) would otherwise grow the map without
 * limit; past this many entries the oldest insertion is evicted (FIFO). Sized
 * generously so the working set of a normal editing session fits, but bounded.
 */
export const MAX_CACHE_ENTRIES = 2_000;

/** Signature used when `getLoadedLibraries` is unavailable/failing. */
const UNKNOWN_SIGNATURE = "<unknown>";

/** The OMC surface the cache needs to read the loaded-library signature. */
export interface LoadedLibrariesClient {
  getLoadedLibraries(): Promise<{ libraries: [string, string][] }>;
}

/**
 * The owning-class probe (`parseFile`) the providers also call on the client.
 * It is a *lifecycle* call (it reads source), NOT a cached lookup — the cache
 * delegates it straight through so a single wrapped client still satisfies the
 * `OwningClassClient` cast the providers do.
 */
export interface ParseFileClient {
  parseFile(input: { fileName: string }): Promise<{ classNames: string[] }>;
}

/**
 * The full surface the cache wraps: the cached lookups (the completion + hover
 * surfaces; {@link HoverClient} adds `getClassComment` and the richer
 * `getClassInformation`) + the signature source + the (pass-through) `parseFile`
 * the providers use for owning-class derivation.
 */
export type CachedOmcClient = CompletionClient &
  HoverClient &
  LoadedLibrariesClient &
  ParseFileClient;

/** A monotonic clock, injectable so tests can drive the signature TTL. */
export type Clock = () => number;

/**
 * The rich `getClassInformation` result (the {@link HoverClient} shape, a
 * superset of the resolver's). Named so the cached method can annotate it and
 * win over the narrow signature TypeScript would otherwise infer from the
 * wrapped client's intersection type.
 */
interface ClassInformation {
  fileName: string;
  lineNumberStart: number;
  columnNumberStart: number;
  restriction: string;
  comment: string;
}

/** One cached value, tagged with the signature it was computed under. */
interface Entry {
  readonly signature: string;
  readonly value: unknown;
}

/**
 * Wraps a {@link CachedOmcClient} and memoises its read-only lookups, keyed by
 * the call's input AND the current loaded-library signature, with a bounded
 * entry map. Implements {@link CompletionClient} so it is a drop-in replacement
 * at the call sites (resolution + completion).
 */
export class OmcLookupCache
  implements CompletionClient, HoverClient, ParseFileClient
{
  private readonly entries = new Map<string, Entry>();

  /** The signature the entry map is currently keyed under (drop-all on change). */
  private lastSignature = UNKNOWN_SIGNATURE;

  /** Cached signature + the in-flight fetch, so a burst shares one round-trip. */
  private signature = UNKNOWN_SIGNATURE;
  private signatureFetchedAt = Number.NEGATIVE_INFINITY;
  private signatureInFlight: Promise<string> | undefined;

  /**
   * Monotonic "the cache contents could now be stale" counter. Bumped by
   * {@link invalidate} and by a signature change. Each lookup captures the
   * generation BEFORE it starts computing and only `set()`s its result if the
   * generation hasn't moved since — so a lookup that started before an
   * `invalidate()` (e.g. an in-flight completion query spanning a save) can't
   * write its now-stale value back after the clear. Closes the
   * in-place-edit/save race where the loaded-library signature is unchanged and
   * therefore the signature guard alone would miss it.
   */
  private generation = 0;

  constructor(
    private inner: CachedOmcClient,
    private readonly now: Clock = () => Date.now(),
  ) {}

  /**
   * Re-point the wrapped client and drop the cache. Used when the underlying
   * OMC subprocess is replaced (REPL `:reset`): the old client's answers are
   * meaningless against the new process, so everything must be re-fetched.
   */
  rewrap(inner: CachedOmcClient): void {
    if (inner === this.inner) return;
    this.inner = inner;
    this.invalidate();
  }

  // --- pass-through (uncached) lifecycle call ------------------------------

  /** `parseFile` is a source read, not a stable lookup — never cached. */
  parseFile(input: { fileName: string }): Promise<{ classNames: string[] }> {
    return this.inner.parseFile(input);
  }

  // --- cached read-only lookups (CompletionClient surface) -----------------

  qualifyPath(input: {
    typeName: string;
    path: string;
  }): Promise<{ qualifiedPath: string }> {
    return this.memoize("qualifyPath", input, () =>
      this.inner.qualifyPath(input),
    );
  }

  getClassInformation(input: { typeName: string }): Promise<ClassInformation> {
    return this.memoize<ClassInformation>(
      "getClassInformation",
      input,
      // The wrapped client's `getClassInformation` is the intersection of the
      // resolver's narrow result and the hover's rich one; TS infers the narrow
      // one, so assert the rich shape the real OMC call always returns.
      () => this.inner.getClassInformation(input) as Promise<ClassInformation>,
    );
  }

  getClassComment(input: { typeName: string }): Promise<{ comment: string }> {
    return this.memoize("getClassComment", input, () =>
      this.inner.getClassComment(input),
    );
  }

  getComponents(input: { typeName: string }): Promise<{
    components: { className: string; name: string }[];
  }> {
    return this.memoize("getComponents", input, () =>
      this.inner.getComponents(input),
    );
  }

  getInheritedClasses(input: {
    typeName: string;
  }): Promise<{ inheritedClasses: string[] }> {
    return this.memoize("getInheritedClasses", input, () =>
      this.inner.getInheritedClasses(input),
    );
  }

  getClassNames(input: {
    typeName?: string;
    qualified?: boolean;
  }): Promise<{ classNames: string[] }> {
    return this.memoize("getClassNames", input, () =>
      this.inner.getClassNames(input),
    );
  }

  searchClassNames(input: {
    searchText: string;
  }): Promise<{ classNames: string[] }> {
    return this.memoize("searchClassNames", input, () =>
      this.inner.searchClassNames(input),
    );
  }

  getParameterNames(input: {
    typeName: string;
  }): Promise<{ parameters: string[] }> {
    return this.memoize("getParameterNames", input, () =>
      this.inner.getParameterNames(input),
    );
  }

  isPackage(input: { typeName: string }): Promise<{ b: boolean }> {
    return this.memoize("isPackage", input, () => this.inner.isPackage(input));
  }

  // --- invalidation ---------------------------------------------------------

  /**
   * Drop every cached entry and forget the signature. Wired to document-save:
   * a save re-loads the file into OMC (its classes may have changed in place,
   * which the library signature can't always see), so clearing here keeps the
   * next resolution honest. Cheap — just clears two in-memory structures.
   */
  invalidate(): void {
    this.entries.clear();
    this.signatureFetchedAt = Number.NEGATIVE_INFINITY;
    this.signature = UNKNOWN_SIGNATURE;
    this.lastSignature = UNKNOWN_SIGNATURE;
    // Bump so any in-flight lookup that started before this clear discards its
    // result instead of writing a now-stale value back into the fresh map.
    this.generation++;
  }

  /** Current entry count — for tests/diagnostics. */
  get size(): number {
    return this.entries.size;
  }

  // --- internals ------------------------------------------------------------

  /**
   * Return a cached value for `(method, input)` under the current signature, or
   * compute it via `compute`, store it, and return it. A signature change drops
   * the whole cache first, so an entry computed under an old signature is never
   * returned. Errors from `compute` are NOT cached — they propagate to the
   * caller (which already degrades to no-result), so a transient OMC failure
   * doesn't poison the cache.
   */
  private async memoize<T>(
    method: string,
    input: unknown,
    compute: () => Promise<T>,
  ): Promise<T> {
    const signature = await this.currentSignature();
    if (signature !== this.lastSignature) {
      // Signature moved since the last lookup: drop everything keyed to the old
      // loaded set so we never return a stale answer across a library change.
      this.entries.clear();
      this.lastSignature = signature;
    }

    const key = `${method}\n${stableStringify(input)}`;
    const hit = this.entries.get(key);
    if (hit && hit.signature === signature) {
      return hit.value as T;
    }

    // Capture the generation AFTER resolving the (current) signature and clearing
    // any stale-signature entries, but BEFORE awaiting `compute()`. An
    // `invalidate()` (or a signature change driven by another lookup) that lands
    // while `compute()` is in flight bumps the generation, so `set()` detects the
    // move and drops this now-stale write. This closes the in-place-edit/save
    // race the loaded-library signature can't see (an in-place save doesn't
    // change the signature, so the `hit.signature === signature` guard would miss
    // it). The value is still returned to *this* caller — it was correct when
    // computed — it just isn't persisted for the next one.
    const gen = this.generation;
    const value = await compute();
    this.set(key, { signature, value }, gen);
    return value;
  }

  /**
   * Store `entry` under `key`, unless the cache generation has moved since the
   * lookup began (`gen`) — that means an `invalidate()`/signature change cleared
   * the map mid-flight, so this value is potentially stale and must not be
   * written back. The result is still returned to *this* caller (it was correct
   * when computed); it just isn't persisted for the next one.
   */
  private set(key: string, entry: Entry, gen: number): void {
    if (this.generation !== gen) return;
    // Refresh insertion order on overwrite so a re-touched key isn't evicted as
    // if it were stale.
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (this.entries.size > MAX_CACHE_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  /**
   * The loaded-library signature, memoised for {@link SIGNATURE_TTL_MS}. A
   * concurrent burst shares one in-flight `getLoadedLibraries`. On failure we
   * return the last known (or sentinel) signature and keep serving rather than
   * throwing — a possibly-extra round-trip beats a broken provider.
   */
  private async currentSignature(): Promise<string> {
    const age = this.now() - this.signatureFetchedAt;
    if (age < SIGNATURE_TTL_MS) return this.signature;
    if (this.signatureInFlight) return this.signatureInFlight;

    this.signatureInFlight = this.fetchSignature();
    try {
      return await this.signatureInFlight;
    } finally {
      this.signatureInFlight = undefined;
    }
  }

  private async fetchSignature(): Promise<string> {
    try {
      const { libraries } = await this.inner.getLoadedLibraries();
      this.signature = libraries
        .map(([name, version]) => `${name}@${version}`)
        .sort()
        .join("\n");
      this.signatureFetchedAt = this.now();
      return this.signature;
    } catch (err) {
      // Keep serving with the last known signature; log so a persistent failure
      // is traceable rather than silently degrading cache correctness.
      log.warn(
        "language",
        "getLoadedLibraries failed; cache signature stale",
        err,
      );
      this.signatureFetchedAt = this.now();
      return this.signature;
    }
  }
}

/**
 * Deterministic JSON for cache keys: object keys are emitted in sorted order at
 * EVERY level so `{a:1,b:{d:4,c:3}}` and `{b:{c:3,d:4},a:1}` hash to the same
 * key. The current lookup inputs are flat primitive records, so this is cheap
 * insurance — it keeps the key canonical if a nested input is ever added rather
 * than silently producing two keys for one logical lookup. Arrays preserve
 * order (it is semantically significant) but their elements are canonicalised.
 */
function stableStringify(input: unknown): string {
  return JSON.stringify(canonicalize(input));
}

/** Recursively sort object keys; arrays keep order, elements canonicalised. */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = canonicalize(record[key]);
  }
  return sorted;
}
