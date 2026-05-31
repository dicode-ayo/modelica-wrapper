/**
 * Backs the diagram webview's library-browser data source with real
 * OMC calls. The webview pings the extension host with
 * `libraryListChildren` / `librarySearch` messages; this module owns
 * the OMC fetches and converts results into the
 * `LibraryClassInfo[]` shape the browser renders.
 *
 * Restrictions are cached per-class for the lifetime of the
 * `LibraryBrowserSource` instance — usually one per diagram panel —
 * so re-expanding a node or repeating a search doesn't re-hit OMC
 * for restrictions it already knows. We do *not* cache the children
 * list itself: OMC may load new packages after the panel opens, and
 * the cost of re-listing is small compared to the unwanted staleness
 * of holding onto an old tree.
 */

import type { OmcClient } from "@dicode/omc-client";

import type {
  LibraryClassInfo,
  LibraryClassRestriction,
} from "../webview/protocol.js";

/** Cap on search results so a `searchAll("a")` doesn't fetch 6000+
 *  restrictions in parallel. The browser shows a flat list; beyond
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

function normaliseRestriction(raw: string): LibraryClassRestriction {
  // OMC may pad with whitespace and occasionally returns capitalised
  // forms (`"Model"`); we want the lowercase canonical variant the
  // browser knows about. Anything we don't recognise falls back to
  // `"unknown"`, which the browser renders with a grey badge and
  // (importantly) treats as expandable — better than silently
  // pretending a class is a leaf.
  const lower = raw.trim().toLowerCase();
  return (KNOWN_RESTRICTIONS as ReadonlySet<string>).has(lower)
    ? (lower as LibraryClassRestriction)
    : "unknown";
}

export class LibraryBrowserSource {
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
    const input = parent === null ? {} : { typeName: parent };
    const { classNames } = await this.client.getClassNames({
      ...input,
      sort: true,
    });
    // `getClassNames` returns local (unqualified) names. Reconstruct
    // the fully-qualified form so the browser, which keys on
    // qualified names for selection + lazy expansion, doesn't have
    // to guess.
    const qualifiedPairs = classNames.map((local) => ({
      local,
      qualified: parent ? `${parent}.${local}` : local,
    }));
    return Promise.all(
      qualifiedPairs.map(async ({ qualified }) => ({
        qualified,
        restriction: await this.getRestriction(qualified),
      })),
    );
  }

  /**
   * Search loaded classes for `query` (substring match on the name).
   * Results are capped at `SEARCH_LIMIT` so a broad term doesn't
   * trigger a flood of restriction calls — the user will refine
   * anyway, and the browser shows a flat list that doesn't paginate.
   */
  async searchAll(query: string): Promise<LibraryClassInfo[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    const { classNames } = await this.client.searchClassNames({
      searchText: trimmed,
    });
    const limited = classNames.slice(0, SEARCH_LIMIT);
    return Promise.all(
      limited.map(async (qualified) => ({
        qualified,
        restriction: await this.getRestriction(qualified),
      })),
    );
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
    } catch {
      // A failed restriction lookup is non-fatal: the browser still
      // renders the row with an `unknown` badge. Don't cache the
      // failure — a later attempt may succeed (e.g. after the user
      // loads more libraries).
      return "unknown";
    }
  }
}
