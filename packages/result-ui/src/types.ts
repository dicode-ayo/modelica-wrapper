/**
 * Render-side view model for the postprocessing UI.
 *
 * These mirror the persisted `*.omresults` wire contract in
 * `@dicode/omc-client` (`ResultViewDoc` etc.) but are declared here so
 * `result-ui` stays **independent** — it depends on neither `omc-client` nor
 * `diagram-ui`, only `lit` + `echarts` + `ui-common` tokens, and can be bundled
 * and distributed on its own. The shapes are structurally identical, so the
 * extension bridge passes the host's parsed document straight onto these
 * properties with no explicit mapping (the same pattern `diagram-ui` uses for
 * its own `ParameterField`).
 */

/** How a result entered the view — drives the chip badge. */
export type ResultSource = "simulate" | "import" | "cache";

/** One `.mat` result in the view. */
export interface ResultRef {
  id: string;
  label: string;
  path: string;
  model?: string;
  createdAt?: string;
  source: ResultSource;
  parameters?: Record<string, string>;
  commit?: string | null;
  dirty?: boolean | null;
}

/** A single plotted line: a variable drawn from one result. */
export interface Trace {
  /** `ResultRef.id`. */
  result: string;
  variable: string;
}

/** A plot card — overlays its traces on one chart. */
export interface PlotCard {
  kind: "plot";
  /** Stable id; data + edit events address a card by this, not array position. */
  id: string;
  title?: string;
  traces?: Trace[];
  xVariable?: string;
}

export type Card = PlotCard;

export interface ResultViewDoc {
  version: 1;
  results: ResultRef[];
  cards: Card[];
}

/** One plotted line's data, read from a `.mat` by the host and pushed down. */
export interface TracePayload {
  /** Independent-variable samples (usually `time`). */
  t: number[];
  /** Dependent-variable samples, aligned with `t`. */
  values: number[];
  /** Legend label, e.g. `"run-1 / motor.w"`. */
  name: string;
}
