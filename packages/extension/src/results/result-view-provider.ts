/**
 * `ResultViewEditorProvider` — the custom editor behind `*.omresults`
 * postprocessing documents, sibling to the diagram custom editor.
 *
 * It renders a CSP-locked webview that loads the `out/postprocessing` bundle
 * (root `<om-result-view-root>`), parses the document with the pure
 * `parseResultViewDoc`, reads the referenced `.mat` trajectories through the
 * shared `OmcClient` (cached by path + mtime), and pushes both down. Card edits
 * from the webview (add/delete plot, add/remove trace, add/remove/rename
 * result) are applied as `WorkspaceEdit`s so undo/redo and git come for free.
 */

import * as vscode from "vscode";

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
  parseResultViewDoc,
  removeResult,
  removeTrace,
  renameResult,
  serializeResultViewDoc,
} from "./result-doc.js";

export const RESULT_VIEW_VIEW_TYPE = "modelica.resultView";

export class ResultViewEditorProvider
  implements vscode.CustomTextEditorProvider
{
  /** Most-recently focused result view, so commands that don't carry a target
   *  (the Simulate auto-add, fired while the *diagram* is focused) know which
   *  document to add to. Held until that view is closed — deliberately NOT
   *  cleared on blur, since the user is on the diagram when they simulate. */
  private static activeDocument: vscode.TextDocument | undefined;

  /** The most-recently focused result view's document, or `undefined` when none
   *  is open. */
  static getActiveDocument(): vscode.TextDocument | undefined {
    return ResultViewEditorProvider.activeDocument;
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

    // Bumped on every refresh so a slow read from a superseded edit is dropped.
    let generation = 0;

    const buildTraceData = async (
      doc: ReturnType<typeof parseResultViewDoc>,
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
              `read ${trace.variable} from ${filePath} failed: ${(err as Error).message}`,
            );
          }
        }
      }
      return out;
    };

    const refresh = async (): Promise<void> => {
      const myGen = ++generation;
      const doc = parseResultViewDoc(document.getText());
      // Push structure immediately so the rail + cards render without waiting on
      // OMC; charts fill in once the trajectories are read.
      post({ type: "doc", doc, traceData: {} });

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
        const [traceData] = await Promise.all([
          buildTraceData(doc),
          missingScan,
        ]);
        if (myGen === generation) post({ type: "doc", doc, traceData });
      } catch (err) {
        post({ type: "status", message: (err as Error).message, error: true });
      } finally {
        if (myGen === generation)
          post({ type: "loading", area: "plots", busy: false });
      }
    };

    const applyDocEdit = (doc: ReturnType<typeof parseResultViewDoc>): void => {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        new vscode.Range(0, 0, document.lineCount, 0),
        serializeResultViewDoc(doc),
      );
      void vscode.workspace.applyEdit(edit);
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) void refresh();
    });

    // Remember the focused view as the Simulate auto-add target. We only set it
    // on focus (never clear on blur): when the user simulates, the *diagram* is
    // focused, so the result they want it added to is the last one they touched.
    const markActive = (): void => {
      ResultViewEditorProvider.activeDocument = document;
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
      if (ResultViewEditorProvider.activeDocument === document) {
        ResultViewEditorProvider.activeDocument = undefined;
      }
    });

    webviewPanel.webview.onDidReceiveMessage((msg: WebviewToExtension) => {
      switch (msg.type) {
        case "ready":
          void refresh();
          return;

        case "requestVariables":
          void this.handleRequestVariables(document, cache, msg, post);
          return;

        case "addPlot":
          applyDocEdit(
            addPlotCard(parseResultViewDoc(document.getText()), msg.afterIndex),
          );
          return;
        case "deletePlot":
          applyDocEdit(
            deleteCard(parseResultViewDoc(document.getText()), msg.cardId),
          );
          return;
        case "addTrace":
          applyDocEdit(
            addTrace(
              parseResultViewDoc(document.getText()),
              msg.cardId,
              msg.resultId,
              msg.variable,
            ),
          );
          return;
        case "removeTrace":
          applyDocEdit(
            removeTrace(
              parseResultViewDoc(document.getText()),
              msg.cardId,
              msg.traceIndex,
            ),
          );
          return;

        case "addResult":
          if (msg.via === "import") {
            void importResults(document);
          } else {
            void addCachedResult(document);
          }
          return;
        case "removeResult":
          applyDocEdit(
            removeResult(parseResultViewDoc(document.getText()), msg.resultId),
          );
          return;
        case "renameResult":
          applyDocEdit(
            renameResult(
              parseResultViewDoc(document.getText()),
              msg.resultId,
              msg.label,
            ),
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
    document: vscode.TextDocument,
    cache: ResultCache,
    msg: Extract<WebviewToExtension, { type: "requestVariables" }>,
    post: (msg: ExtensionToWebview) => void,
  ): Promise<void> {
    const doc = parseResultViewDoc(document.getText());
    const result = doc.results.find((r) => r.id === msg.resultId);
    if (!result) {
      post({
        type: "variables",
        resultId: msg.resultId,
        error: "unknown result",
      });
      return;
    }
    const filePath = resolveResultPath(document.uri, result.path);
    try {
      const vars = await cache.variables(filePath);
      post({ type: "variables", resultId: msg.resultId, vars });
    } catch (err) {
      post({
        type: "variables",
        resultId: msg.resultId,
        error: (err as Error).message,
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
