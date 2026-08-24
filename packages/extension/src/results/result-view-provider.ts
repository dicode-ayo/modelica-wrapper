/**
 * `ResultViewEditorProvider` — the custom editor behind `*.omresults`
 * postprocessing documents, sibling to the diagram custom editor.
 *
 * It renders a CSP-locked webview that loads the `out/postprocessing` bundle
 * (root `<om-result-view-root>`), reads the document through a
 * `ResultViewDocument` (which persists any id it backfills before handing the
 * doc back), reads the referenced `.mat` trajectories through the shared
 * `OmcClient` (cached by path + mtime), and pushes both down. Card edits from
 * the webview (add/delete plot, add/remove trace, add/remove/rename result)
 * are applied as `WorkspaceEdit`s via the same `ResultViewDocument`, so
 * undo/redo and git come for free.
 */

import * as vscode from "vscode";

import type { ResultViewDoc } from "@dicode/omc-client";

import { errorDetail } from "../error-detail.js";
import { log } from "../logger.js";
import { renderWebviewPage } from "../webview/webview-page.js";
import type {
  ExtensionToWebview,
  TracePayload,
  WebviewToExtension,
} from "../webview/postprocessing-protocol.js";
import {
  addCachedResult,
  importResults,
  resolveResultPath,
} from "./add-result.js";
import { ResultCache, type ResultReader } from "./result-cache.js";
import {
  addPlotCard,
  addTrace,
  deleteCard,
  removeResult,
  removeTrace,
  renameResult,
} from "./result-doc.js";
import { ResultViewDocument } from "./result-view-document.js";

export const RESULT_VIEW_VIEW_TYPE = "modelica.resultView";

export class ResultViewEditorProvider
  implements vscode.CustomTextEditorProvider
{
  /** Most-recently focused result view's `ResultViewDocument`, so commands that
   *  don't carry a target (the Simulate auto-add, fired while the *diagram* is
   *  focused) know which document to add to, and write through the same queue
   *  its own card edits do. Held until that view is closed — deliberately NOT
   *  cleared on blur, since the user is on the diagram when they simulate. */
  private static activeResultDoc: ResultViewDocument | undefined;

  /** The most-recently focused result view's `ResultViewDocument`, or
   *  `undefined` when none is open. */
  static getActiveResultDoc(): ResultViewDocument | undefined {
    return ResultViewEditorProvider.activeResultDoc;
  }

  private constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly ensureClient: () => Promise<ResultReader>,
    private readonly statMtimeMs?: (
      path: string,
    ) => Promise<number | undefined>,
  ) {}

  static register(
    context: vscode.ExtensionContext,
    ensureClient: () => Promise<ResultReader>,
    statMtimeMs?: (path: string) => Promise<number | undefined>,
  ): vscode.Disposable {
    const provider = new ResultViewEditorProvider(
      context.extensionUri,
      ensureClient,
      statMtimeMs,
    );
    return vscode.window.registerCustomEditorProvider(
      RESULT_VIEW_VIEW_TYPE,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    );
  }

  resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "out")],
    };
    webviewPanel.webview.html = this.renderHtml(webviewPanel.webview);

    // Per-editor cache, lazily backed by the shared OMC client (resolved per
    // read). Reads serialize through the client's promise-chain mutex (OMC is
    // single-threaded).
    const cache = new ResultCache(this.ensureClient, this.statMtimeMs);
    const post = (msg: ExtensionToWebview): void => {
      void webviewPanel.webview.postMessage(msg);
    };
    const resultDoc = new ResultViewDocument(document, () =>
      post({
        type: "status",
        message: `Couldn't save changes to ${document.uri.fsPath} — see the Modelica output channel for details.`,
        error: true,
      }),
    );

    // Bumped on every refresh so a slow read from a superseded edit is dropped.
    let generation = 0;

    const buildTraceData = async (
      doc: ResultViewDoc,
    ): Promise<Record<string, TracePayload[]>> => {
      const resultById = new Map(doc.results.map((r) => [r.id, r]));
      const out: Record<string, TracePayload[]> = {};
      for (const card of doc.cards) {
        if (card.kind !== "plot") continue;
        for (const trace of card.traces ?? []) {
          const result = resultById.get(trace.result);
          if (!result) continue; // dangling — result removed
          const filePath = resolveResultPath(document.uri, result.path);
          try {
            const traj = await cache.trajectory(filePath, trace.variable);
            if (!traj) continue;
            (out[card.id] ??= []).push({
              t: traj.t,
              values: traj.values,
              name: `${result.label} / ${trace.variable}`,
            });
          } catch (err) {
            log.warn(
              "resultView",
              `read ${trace.variable} from ${filePath} failed: ${errorDetail(err)}`,
            );
          }
        }
      }
      return out;
    };

    const refresh = async (): Promise<void> => {
      const myGen = ++generation;
      // A rejection means the id-backfill write failed to persist;
      // `onWriteFailure` above already reported it to the user, so just skip
      // this refresh rather than posting a doc with unpersisted ids.
      const doc = await resultDoc.read().catch((err: unknown) => {
        log.warn("resultView", `refresh failed: ${errorDetail(err)}`);
        return undefined;
      });
      if (doc === undefined) return;
      // Push structure before waiting on OMC; charts fill in once the
      // trajectories are read. Gated like every other post below: `read()` is
      // async, so a superseded refresh can resolve after a newer one.
      if (myGen === generation) post({ type: "doc", doc, traceData: {} });

      // Independent of whether any card has traces — a result with no card
      // referencing it yet can still be missing its backing file. Runs
      // concurrently with the trace read below: a disk stat and an OMC read
      // are unrelated I/O with no reason to serialize.
      const missingScan = (async (): Promise<void> => {
        const missingIds = (
          await Promise.all(
            doc.results.map(async (result) => {
              const filePath = resolveResultPath(document.uri, result.path);
              return (await cache.exists(filePath)) ? null : result.id;
            }),
          )
        ).filter((id): id is string => id !== null);
        if (myGen === generation)
          post({ type: "missingResults", ids: missingIds });
      })();

      const hasTraces = doc.cards.some((c) => (c.traces?.length ?? 0) > 0);
      if (!hasTraces) {
        await missingScan;
        return;
      }

      post({ type: "loading", area: "plots", busy: true });
      try {
        const traceData = await buildTraceData(doc);
        if (myGen === generation) post({ type: "doc", doc, traceData });
      } catch (err) {
        if (myGen === generation)
          post({
            type: "status",
            message: errorDetail(err),
            error: true,
          });
      } finally {
        if (myGen === generation)
          post({ type: "loading", area: "plots", busy: false });
      }
      await missingScan;
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) void refresh();
    });

    // Remember the focused view as the Simulate auto-add target. We only set it
    // on focus (never clear on blur): when the user simulates, the *diagram* is
    // focused, so the result they want it added to is the last one they touched.
    const markActive = (): void => {
      ResultViewEditorProvider.activeResultDoc = resultDoc;
    };
    if (webviewPanel.active) {
      markActive();
    }
    const viewStateSub = webviewPanel.onDidChangeViewState(() => {
      if (webviewPanel.active) {
        markActive();
      }
    });
    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
      viewStateSub.dispose();
      if (ResultViewEditorProvider.activeResultDoc === resultDoc) {
        ResultViewEditorProvider.activeResultDoc = undefined;
      }
    });

    webviewPanel.webview.onDidReceiveMessage((msg: WebviewToExtension) => {
      switch (msg.type) {
        case "ready":
          void refresh();
          return;

        case "requestVariables":
          void this.handleRequestVariables(resultDoc, cache, msg, post);
          return;

        case "addPlot":
          void resultDoc.mutate((doc) => addPlotCard(doc, msg.afterIndex));
          return;
        case "deletePlot":
          void resultDoc.mutate((doc) => deleteCard(doc, msg.cardId));
          return;
        case "addTrace":
          void resultDoc.mutate((doc) =>
            addTrace(doc, msg.cardId, msg.resultId, msg.variable),
          );
          return;
        case "removeTrace":
          void resultDoc.mutate((doc) =>
            removeTrace(doc, msg.cardId, msg.traceIndex),
          );
          return;

        case "addResult":
          if (msg.via === "import") {
            void importResults(resultDoc);
          } else {
            void addCachedResult(resultDoc);
          }
          return;
        case "removeResult":
          void resultDoc.mutate((doc) => removeResult(doc, msg.resultId));
          return;
        case "renameResult":
          void resultDoc.mutate((doc) =>
            renameResult(doc, msg.resultId, msg.label),
          );
          return;

        default:
          // A new protocol variant must add a case above; this keeps the
          // compiler enforcing that.
          return msg satisfies never;
      }
    });
  }

  private async handleRequestVariables(
    resultDoc: ResultViewDocument,
    cache: ResultCache,
    msg: Extract<WebviewToExtension, { type: "requestVariables" }>,
    post: (msg: ExtensionToWebview) => void,
  ): Promise<void> {
    const doc = await resultDoc.read().catch((err: unknown) => {
      log.warn(
        "resultView",
        `requestVariables for ${msg.resultId} failed: ${errorDetail(err)}`,
      );
      post({
        type: "variables",
        resultId: msg.resultId,
        error:
          "Couldn't load this result's variables — see the Modelica output channel for details.",
      });
      return undefined;
    });
    if (doc === undefined) return;
    const result = doc.results.find((r) => r.id === msg.resultId);
    if (!result) {
      post({
        type: "variables",
        resultId: msg.resultId,
        error: "This result no longer exists.",
      });
      return;
    }
    const filePath = resolveResultPath(resultDoc.uri, result.path);
    try {
      const vars = await cache.variables(filePath);
      post({ type: "variables", resultId: msg.resultId, vars });
    } catch (err) {
      post({
        type: "variables",
        resultId: msg.resultId,
        error: errorDetail(err),
      });
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    return renderWebviewPage({
      webview,
      extensionUri: this.extensionUri,
      entry: "postprocessing",
      title: "Modelica results",
      root: "<om-result-view-root></om-result-view-root>",
    });
  }
}
