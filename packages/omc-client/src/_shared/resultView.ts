/**
 * The `*.omresults` postprocessing document — OUR shape, persisted as JSON and
 * edited through a VSCode `CustomTextEditorProvider`. See the design note in
 * `docs/postprocessing-design.md`.
 *
 * This module is the **wire contract only**: the types + Zod schemas that both
 * the host (`extension`) and the renderer (`result-ui`) agree on, exactly like
 * `DiagramLayout`. It carries no behaviour — by design, the document is not an
 * OMC product (nothing here is derived from an OMC call), so the host-side I/O
 * (`parse`/`serialize`, read-planning) lives in the `extension` package and the
 * webview-side variable tree lives in `result-ui`. The contract lives here only
 * because `omc-client` is the one package both sides already depend on.
 *
 * Unlike the Dyad runtime POC this models, a document is NOT bound to a single
 * model: `results` is a free collection of `.mat` files, each possibly produced
 * by a different model simulation. There is therefore no shared `signals` list —
 * each result's variables are discovered lazily at the host edge via
 * `readSimulationResultVars` and never persisted here. A trace references a
 * result by `id` plus a dotted variable path.
 *
 * Conventions mirror `diagramLayout.ts`: `.strict()` on every schema, optional
 * fields typed `T | undefined`, the top-level schema cast to the hand-written
 * interface.
 */

import { z } from "zod";

// ---------- public types ----------

/** How a result entered the view — drives the badge in the UI. */
export type ResultSource = "simulate" | "import" | "cache";

/** One `.mat` result file in a view. */
export interface ResultRef {
  /** Stable id minted on add; trace keys reference it. */
  id: string;
  /** User-facing name (default: model name, else the file stem). */
  label: string;
  /** `.mat` path — relative to the doc when under its folder, else absolute. */
  path: string;
  /** Class name that produced it, when known. */
  model?: string | undefined;
  /** ISO timestamp the result was added. */
  createdAt?: string | undefined;
  /** How it entered the view. */
  source: ResultSource;
  /** Run overrides, when added from Simulate. */
  parameters?: Record<string, string> | undefined;
  /** Git provenance captured at add time (`null` = not a repo / unknown). */
  commit?: string | null | undefined;
  dirty?: boolean | null | undefined;
}

/** A single plotted line: a variable drawn from one result. */
export interface Trace {
  /** `ResultRef.id`. */
  result: string;
  /** Dotted variable path within that result (e.g. `motor.w`). */
  variable: string;
}

/** A plot card — overlays its traces on one chart. */
export interface PlotCard {
  kind: "plot";
  /** Stable id; minted on add and backfilled when parsing a legacy doc. Data
   * and edit operations address a card by this, never by array position. */
  id: string;
  title?: string | undefined;
  traces?: Trace[] | undefined;
  /** Independent variable; defaults to `time`. Forward-looking. */
  xVariable?: string | undefined;
}

/**
 * A card in the view. v1 has one variant; the union is kept open so note /
 * value cards land later without a document migration (the same foresight as
 * `ParameterField` mirroring the `Dialog` record).
 */
export type Card = PlotCard;

export interface ResultViewDoc {
  /** Schema version, for forward migration. */
  version: 1;
  results: ResultRef[];
  cards: Card[];
}

// ---------- schemas ----------

const ResultSourceSchema = z.union([
  z.literal("simulate"),
  z.literal("import"),
  z.literal("cache"),
]);

export const ResultRefSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    path: z.string(),
    model: z.string().optional(),
    createdAt: z.string().optional(),
    source: ResultSourceSchema,
    parameters: z.record(z.string(), z.string()).optional(),
    commit: z.string().nullable().optional(),
    dirty: z.boolean().nullable().optional(),
  })
  .strict();

export const TraceSchema = z
  .object({
    result: z.string(),
    variable: z.string(),
  })
  .strict();

export const PlotCardSchema = z
  .object({
    kind: z.literal("plot"),
    // Optional on the wire so legacy / hand-authored docs validate; the host's
    // `parseResultViewDoc` backfills a minted id for any card missing one.
    id: z.string().optional(),
    title: z.string().optional(),
    traces: z.array(TraceSchema).optional(),
    xVariable: z.string().optional(),
  })
  .strict();

/**
 * Single-variant today; written as a standalone schema so it becomes
 * `z.discriminatedUnion("kind", [PlotCardSchema, …])` when note/value cards
 * arrive, without touching callers.
 */
export const CardSchema = PlotCardSchema;

const ResultViewDocObject = z
  .object({
    version: z.literal(1),
    results: z.array(ResultRefSchema),
    cards: z.array(CardSchema),
  })
  .strict();
export const ResultViewDocSchema =
  ResultViewDocObject as unknown as z.ZodType<ResultViewDoc>;

// ---------- factory ----------

/** The canonical empty document. */
export function emptyResultViewDoc(): ResultViewDoc {
  return { version: 1, results: [], cards: [] };
}
