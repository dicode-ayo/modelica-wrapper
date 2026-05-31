/**
 * Host-side behaviour for the `*.omresults` postprocessing document: parse,
 * serialize, and the pure card-edit transforms. These are host concerns — the
 * webview never parses the file (it receives an already-parsed `doc` over
 * `postMessage`), so they live here rather than in the shared `omc-client`
 * contract. Pure: no VSCode, no OMC.
 *
 * The document *shape* (types + Zod schemas) is the wire contract in
 * `@dicode/omc-client`; this module imports it and adds behaviour.
 */

import { randomUUID } from "node:crypto";

import {
  CardSchema,
  emptyResultViewDoc,
  ResultRefSchema,
  ResultViewDocSchema,
  type Card,
  type ResultRef,
  type ResultViewDoc,
} from "@dicode/omc-client";

// ---------- parse / serialize ----------

/**
 * Parse `*.omresults` text into a valid document. Never throws: bad JSON yields
 * an empty doc, malformed `results` / `cards` entries are dropped, a card with
 * no `kind` defaults to `"plot"`, a card with no `id` is given a minted one, and
 * a `plots` array (the Dyad-style name) is accepted as an alias for `cards`.
 * `version` is always normalised to 1. `mintCardId` is injectable so the
 * backfill is deterministic under test.
 */
export function parseResultViewDoc(
  text: string,
  mintCardId: () => string = randomUUID,
): ResultViewDoc {
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
    if (parsed.success) {
      cards.push({
        ...parsed.data,
        id: parsed.data.id ?? mintCardId(),
      } as Card);
    }
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

function sortedByKey(
  obj: Record<string, string> | undefined,
): Record<string, string> | undefined {
  // Sort keys so a parameters map serializes identically regardless of the
  // order entries were inserted — the same determinism goal as the fixed
  // field order below.
  if (obj === undefined) return undefined;
  const out: Record<string, string> = {};
  for (const key of Object.keys(obj).sort()) out[key] = obj[key]!;
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
    parameters: sortedByKey(r.parameters),
    commit: r.commit,
    dirty: r.dirty,
  });
}

function canonicalCard(c: Card): Record<string, unknown> {
  return dropUndefined({
    kind: c.kind,
    id: c.id,
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
  const safe = ResultViewDocSchema.parse(doc);
  const canonical = {
    version: 1 as const,
    results: safe.results.map(canonicalRef),
    cards: safe.cards.map(canonicalCard),
  };
  return JSON.stringify(canonical, null, 2) + "\n";
}

// ---------- edit transforms ----------

/**
 * The lowest unused `Plot N` title, so numbering doesn't collide after a card in
 * the middle is deleted (count-based naming would re-mint `Plot 3` once a
 * `Plot 3` was removed).
 */
function nextPlotTitle(cards: readonly Card[]): string {
  const used = new Set<number>();
  for (const c of cards) {
    const match = /^Plot (\d+)$/.exec(c.title ?? "");
    if (match?.[1]) used.add(Number(match[1]));
  }
  let n = 1;
  while (used.has(n)) {
    n++;
  }
  return `Plot ${n}`;
}

/**
 * Insert a new empty plot card after `afterIndex` (`-1` = at the top; any value
 * `>= cards.length` appends). `mintId` is injectable so the transform stays pure
 * and deterministic under test.
 */
export function addPlotCard(
  doc: ResultViewDoc,
  afterIndex: number,
  mintId: () => string = randomUUID,
): ResultViewDoc {
  const cards = [...doc.cards];
  const at = Math.min(Math.max(afterIndex, -1), cards.length - 1);
  cards.splice(at + 1, 0, {
    kind: "plot",
    id: mintId(),
    title: nextPlotTitle(doc.cards),
  });
  return { ...doc, cards };
}

/** Drop the card with `cardId` (a no-op when it isn't present). */
export function deleteCard(doc: ResultViewDoc, cardId: string): ResultViewDoc {
  return { ...doc, cards: doc.cards.filter((c) => c.id !== cardId) };
}

/** Append a `(result, variable)` trace to the plot card with `cardId`. The
 * `kind` guard keeps traces off non-plot cards once the `Card` union grows. */
export function addTrace(
  doc: ResultViewDoc,
  cardId: string,
  resultId: string,
  variable: string,
): ResultViewDoc {
  return {
    ...doc,
    cards: doc.cards.map((c) =>
      c.id === cardId && c.kind === "plot"
        ? {
            ...c,
            traces: [...(c.traces ?? []), { result: resultId, variable }],
          }
        : c,
    ),
  };
}

/** Remove the trace at `traceIndex` from the plot card with `cardId`. */
export function removeTrace(
  doc: ResultViewDoc,
  cardId: string,
  traceIndex: number,
): ResultViewDoc {
  return {
    ...doc,
    cards: doc.cards.map((c) =>
      c.id === cardId && c.kind === "plot"
        ? { ...c, traces: (c.traces ?? []).filter((_, i) => i !== traceIndex) }
        : c,
    ),
  };
}

/**
 * Append a result to the view. Callers mint `ref.id` and de-duplicate by
 * resolved path beforehand — the transform can't resolve a relative path
 * against the document's folder, so it stays pure and just appends.
 */
export function addResult(doc: ResultViewDoc, ref: ResultRef): ResultViewDoc {
  return { ...doc, results: [...doc.results, ref] };
}
