/**
 * Backs the library sidebar's data source with real OMC calls. The webview
 * pings the extension host with `libraryListChildren` / `librarySearch`
 * messages; this module owns the OMC fetches and converts results into the
 * `LibraryClassInfo[]` shape the tree renders.
 *
 * Restrictions are cached per-class for the lifetime of the `LibrarySource`
 * instance, so re-expanding a node or repeating a search doesn't re-hit OMC
 * for restrictions it already knows. We do *not* cache the children
 * list itself: OMC may load new packages after the view opens, and
 * the cost of re-listing is small compared to the unwanted staleness
 * of holding onto an old tree.
 */

import type { OmcClient } from "@dicode/omc-client";

import { log } from "../logger.js";
import type {
  LibraryClassInfo,
  LibraryClassRestriction,
} from "../webview/library-messages.js";

/** Cap on search results so a `searchAll("a")` doesn't fetch 6000+
 *  restrictions in parallel. The tree shows a flat list; beyond
 *  ~50 the user is going to refine the query anyway. */
const SEARCH_LIMIT = 80;

const KNOWN_RESTRICTIONS: ReadonlySet<LibraryClassRestriction> = new Set([
  "package",
  "model",
  "block",
  "class",
  "connector",
  "expandable connector",
  "record",
  "function",
  "type",
  "operator",
  "operator function",
  "operator record",
  "unknown",
]);

/** Thrown out of `searchAll` once the webview stops wanting the result. */
export class SearchAbortedError extends Error {
  constructor() {
    super("search aborted");
    this.name = "SearchAbortedError";
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new SearchAbortedError();
}

function normaliseRestriction(raw: string): LibraryClassRestriction {
  // OMC may pad with whitespace and occasionally returns capitalised
  // forms (`"Model"`); we want the lowercase canonical variant the
  // tree knows about. Anything we don't recognise falls back to
  // `"unknown"`, which the tree renders with a grey badge and
  // (importantly) treats as expandable — better than silently
  // pretending a class is a leaf.
  const lower = raw.trim().toLowerCase();
  return (KNOWN_RESTRICTIONS as ReadonlySet<string>).has(lower)
    ? (lower as LibraryClassRestriction)
    : "unknown";
}

export class LibrarySource {
  private readonly restrictionCache = new Map<
    string,
    LibraryClassRestriction
  >();

  constructor(private readonly client: OmcClient) {}

  /**
   * Enumerate immediate child classes of `parent`. `null` returns
   * loaded top-level packages.
   */
  async listChildren(parent: string | null): Promise<LibraryClassInfo[]> {
    const started = Date.now();
    const input = parent === null ? {} : { typeName: parent };
    const { classNames } = await this.client.getClassNames({
      ...input,
      sort: true,
    });
    // `getClassNames` returns local (unqualified) names. Reconstruct
    // the fully-qualified form so the tree, which keys on
    // qualified names for selection + lazy expansion, doesn't have
    // to guess.
    const qualifiedPairs = classNames.map((local) => ({
      local,
      qualified: parent ? `${parent}.${local}` : local,
    }));
    const misses = this.uncachedCount(qualifiedPairs.map((p) => p.qualified));
    const rows = await Promise.all(
      qualifiedPairs.map(async ({ qualified }) => ({
        qualified,
        restriction: await this.getRestriction(qualified),
      })),
    );
    log.debug(
      "librarySource",
      `listChildren(${parent ?? "<roots>"}) → ${rows.length} rows, ` +
        `${misses} restriction calls, ${Date.now() - started}ms`,
    );
    return rows;
  }

  /**
   * Search loaded classes for `query` (substring match on the name).
   * Results are capped at `SEARCH_LIMIT` so a broad term doesn't
   * trigger a flood of restriction calls — the user will refine
   * anyway, and the tree shows a flat list that doesn't paginate.
   */
  async searchAll(
    query: string,
    signal?: AbortSignal,
  ): Promise<LibraryClassInfo[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    const started = Date.now();
    const { classNames } = await this.client.searchClassNames({
      searchText: trimmed,
    });
    const limited = classNames.slice(0, SEARCH_LIMIT);
    const misses = this.uncachedCount(limited);
    // Sequential, not `Promise.all`: OMC runs these one at a time regardless,
    // and issuing them upfront would put every lookup on the queue before the
    // first `signal.aborted` check could drop the rest.
    const rows: LibraryClassInfo[] = [];
    for (const qualified of limited) {
      throwIfAborted(signal);
      rows.push({
        qualified,
        restriction: await this.getRestriction(qualified),
      });
    }
    log.debug(
      "librarySource",
      `searchAll(${JSON.stringify(trimmed)}) → ${classNames.length} hits, ` +
        `${rows.length} shown, ${misses} restriction calls, ${Date.now() - started}ms`,
    );
    if (classNames.length > SEARCH_LIMIT) {
      log.debug(
        "librarySource",
        `searchAll(${JSON.stringify(trimmed)}) truncated to ${SEARCH_LIMIT} of ${classNames.length}`,
      );
    }
    return rows;
  }

  /** How many of `qualified` would cost an OMC round-trip right now. */
  private uncachedCount(qualified: readonly string[]): number {
    return qualified.filter((q) => !this.restrictionCache.has(q)).length;
  }

  private async getRestriction(
    qualified: string,
  ): Promise<LibraryClassRestriction> {
    const cached = this.restrictionCache.get(qualified);
    if (cached !== undefined) return cached;
    try {
      const { restriction } = await this.client.getClassRestriction({
        typeName: qualified,
      });
      const norm = normaliseRestriction(restriction);
      this.restrictionCache.set(qualified, norm);
      return norm;
    } catch (err) {
      // A failed restriction lookup is non-fatal: the tree still
      // renders the row with an `unknown` badge. Don't cache the
      // failure — a later attempt may succeed (e.g. after the user
      // loads more libraries).
      log.debug(
        "librarySource",
        `getClassRestriction(${qualified}) failed: ${(err as Error).message}`,
      );
      return "unknown";
    }
  }
}
