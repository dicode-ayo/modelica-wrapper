/**
 * Host-side I/O for the `*.omresults` postprocessing document: parse, serialize,
 * and read-planning. These are host concerns — the webview never parses the file
 * (it receives an already-parsed `doc` over `postMessage`), so they live here
 * rather than in the shared `omc-client` contract. Pure: no VSCode, no OMC.
 *
 * The document *shape* (types + Zod schemas) is the wire contract in
 * `@modelica-wrapper/omc-client`; this module imports it and adds behaviour.
 */

import {
  CardSchema,
  emptyResultViewDoc,
  ResultRefSchema,
  ResultViewDocSchema,
  type Card,
  type ResultRef,
  type ResultViewDoc,
} from "@modelica-wrapper/omc-client";

// ---------- parse / serialize ----------

/**
 * Parse `*.omresults` text into a valid document. Never throws: bad JSON yields
 * an empty doc, malformed `results` / `cards` entries are dropped, a card with
 * no `kind` defaults to `"plot"`, and a `plots` array (the Dyad-style name) is
 * accepted as an alias for `cards`. `version` is always normalised to 1.
 */
export function parseResultViewDoc(text: string): ResultViewDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptyResultViewDoc();
  }
  if (raw === null || typeof raw !== "object") {
    return emptyResultViewDoc();
  }
  const obj = raw as Record<string, unknown>;

  const results: ResultRef[] = [];
  if (Array.isArray(obj.results)) {
    for (const r of obj.results) {
      const parsed = ResultRefSchema.safeParse(r);
      if (parsed.success) results.push(parsed.data as ResultRef);
    }
  }

  const rawCards = Array.isArray(obj.cards)
    ? obj.cards
    : Array.isArray(obj.plots)
      ? obj.plots
      : [];
  const cards: Card[] = [];
  for (const c of rawCards) {
    const withKind =
      c !== null &&
      typeof c === "object" &&
      (c as Record<string, unknown>).kind === undefined
        ? { ...(c as Record<string, unknown>), kind: "plot" }
        : c;
    const parsed = CardSchema.safeParse(withKind);
    if (parsed.success) cards.push(parsed.data as Card);
  }

  return { version: 1, results, cards };
}

function dropUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

function canonicalRef(r: ResultRef): Record<string, unknown> {
  // Fixed key order → deterministic, git-diff-friendly output regardless of
  // the order keys were set in code. `null` (meaningful for commit/dirty) is
  // kept; only `undefined` is dropped.
  return dropUndefined({
    id: r.id,
    label: r.label,
    path: r.path,
    model: r.model,
    source: r.source,
    createdAt: r.createdAt,
    parameters: r.parameters,
    commit: r.commit,
    dirty: r.dirty,
  });
}

function canonicalCard(c: Card): Record<string, unknown> {
  return dropUndefined({
    kind: c.kind,
    title: c.title,
    traces: c.traces?.map((t) => ({ result: t.result, variable: t.variable })),
    xVariable: c.xVariable,
  });
}

/**
 * Serialize a document to stable, pretty JSON with a fixed key order and a
 * trailing newline. Validates first so a malformed in-code document fails fast
 * rather than being persisted.
 */
export function serializeResultViewDoc(doc: ResultViewDoc): string {
  const safe = ResultViewDocSchema.parse(doc) as ResultViewDoc;
  const canonical = {
    version: 1 as const,
    results: safe.results.map(canonicalRef),
    cards: safe.cards.map(canonicalCard),
  };
  return JSON.stringify(canonical, null, 2) + "\n";
}

// ---------- data-fetch planning ----------

/** Cache key for one `(result, variable)` trajectory. Use everywhere so the
 * host's cache and {@link tracesNeedingData} agree on the keying. */
export function traceCacheKey(resultId: string, variable: string): string {
  return `${resultId} ${variable}`;
}

/**
 * Plan which `(result, variable)` trajectories the host still has to read:
 * every plot-card trace whose result exists in the doc and whose
 * {@link traceCacheKey} isn't already in `cached`. Traces pinned to a removed
 * result are skipped (dangling). Pure — the host does the actual reads.
 */
export function tracesNeedingData(
  doc: ResultViewDoc,
  cached: ReadonlySet<string>,
): Map<string, Set<string>> {
  const needed = new Map<string, Set<string>>();
  const known = new Set(doc.results.map((r) => r.id));
  for (const card of doc.cards) {
    if (card.kind !== "plot") continue;
    for (const tr of card.traces ?? []) {
      if (!known.has(tr.result)) continue;
      if (cached.has(traceCacheKey(tr.result, tr.variable))) continue;
      let set = needed.get(tr.result);
      if (!set) {
        set = new Set<string>();
        needed.set(tr.result, set);
      }
      set.add(tr.variable);
    }
  }
  return needed;
}
