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
 * data path (`variables` / `loading`) and the card-edit messages are wired in
 * #84 / #85. The add/remove/rename-result messages are defined here but only
 * handled from #86 / #87 onward.
 */

import type { ResultViewDoc } from "@dicode/omc-client";

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
  /** Seed / refresh: the parsed document plus any trace data already read, keyed
   *  by card id. The host always pushes a full snapshot. */
  | {
      type: "doc";
      doc: ResultViewDoc;
      traceData: Record<string, TracePayload[]>;
    }
  /** Response to `requestVariables` — a result's variable list, lazily read.
   *  Keyed by `resultId`; the webview merges it into its per-result map. */
  | { type: "variables"; resultId: string; vars?: string[]; error?: string }
  /** Spinner gating while the host reads results / variables. */
  | { type: "loading"; area: "results" | "plots"; busy: boolean }
  /** A read / parse error, logged to the webview console as a diagnostic — not
   *  yet surfaced in the UI. */
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
  /** Fetch a result's variable list; the reply (`variables`) is keyed by
   *  `resultId`, which is enough to route it — replies don't overlap per result. */
  | { type: "requestVariables"; resultId: string }
  /** Add a result — the host opens the file dialog (`import`) or the
   *  `.modelica` cache quick-pick (`cache`). Matches `ResultSource`. */
  | { type: "addResult"; via: "import" | "cache" }
  | { type: "removeResult"; resultId: string }
  | { type: "renameResult"; resultId: string; label: string }
  /** Diagnostic from the webview. */
  | { type: "error"; message: string };
