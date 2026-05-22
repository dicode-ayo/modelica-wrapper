/**
 * Wire protocol between the postprocessing webview (`<om-result-view-root>` in
 * `postprocessing-entry.ts`) and its host (`ResultViewEditorProvider`). Two
 * JSON-serialisable tagged unions, discriminated on `type`, mirroring the
 * diagram's `protocol.ts`.
 *
 * The webview is a dumb renderer: it never reads the `.omresults` file or calls
 * OMC. The host parses the document, reads `.mat` data, and pushes everything
 * down; the webview emits intent (add a plot, add a trace, …) back up.
 *
 * Slice status: the provider skeleton (#83) sends `doc` and handles `ready`; the
 * data-path (`variables` / `traceData` / `loading`) and the edit/add messages
 * are wired in #84 / #85. The full shapes are defined here now so both sides
 * compile against one contract.
 */

import type { ResultViewDoc } from "@modelica-wrapper/omc-client";

/** One plotted line's data: a variable's trajectory from one result. Not part
 * of the persisted document — it's read on demand from the `.mat` and pushed to
 * the webview. */
export interface TracePayload {
  /** Independent-variable samples (usually `time`). */
  t: number[];
  /** Dependent-variable samples, aligned with `t`. */
  values: number[];
  /** Legend label, e.g. `"run-1 / motor.w"`. */
  name: string;
}

// ── Extension host → webview ────────────────────────────────────────────────

export type ExtensionToWebview =
  /** Seed / refresh: the parsed document plus any trace data already cached,
   *  keyed by card id (empty until the data path lands in #84). */
  | { type: "doc"; doc: ResultViewDoc; traceData: Record<string, TracePayload[]> }
  /** Response to `requestVariables` — a result's variable list, lazily read. */
  | { type: "variables"; requestId: string; resultId: string; vars?: string[]; error?: string }
  /** Incremental single-trace append for a card. */
  | { type: "traceData"; cardId: string; trace: TracePayload }
  /** Spinner gating while the host reads results / variables. */
  | { type: "loading"; area: "results" | "plots"; busy: boolean }
  /** Surface a read / parse error in the webview. */
  | { type: "status"; message: string; error?: boolean };

// ── Webview → extension host ────────────────────────────────────────────────

export type WebviewToExtension =
  /** Webview mounted; host replies with `doc`. */
  | { type: "ready" }
  /** Insert a new plot card after `afterIndex` (`-1` = at the top). Insertion is
   *  the one positional op; every other card op addresses a card by `cardId`. */
  | { type: "addPlot"; afterIndex: number }
  | { type: "deletePlot"; cardId: string }
  | { type: "addTrace"; cardId: string; resultId: string; variable: string }
  | { type: "removeTrace"; cardId: string; traceIndex: number }
  /** Fetch a result's variable list (correlated by `requestId`). */
  | { type: "requestVariables"; requestId: string; resultId: string }
  /** Add a result — the host opens the file dialog (`import`) or the
   *  `.modelica` cache quick-pick (`cache`). Matches `ResultSource`. */
  | { type: "addResult"; via: "import" | "cache" }
  | { type: "removeResult"; resultId: string }
  | { type: "renameResult"; resultId: string; label: string }
  /** Diagnostic from the webview. */
  | { type: "error"; message: string };
