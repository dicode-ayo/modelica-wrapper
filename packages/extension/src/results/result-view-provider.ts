/**
 * `ResultViewEditorProvider` — the custom editor behind `*.omresults`
 * postprocessing documents, sibling to the diagram's `DiagramPanel`.
 *
 * It renders a CSP-locked webview that loads the `out/postprocessing` bundle
 * (root `<om-result-view-root>`), parses the document with the pure
 * `parseResultViewDoc`, reads the referenced `.mat` trajectories through the
 * shared `OmcClient` (cached by path + mtime), and pushes both down. Card edits
 * from the webview (add/delete plot, add/remove trace) are applied as
 * `WorkspaceEdit`s so undo/redo and git come for free. Adding results (file
 * pick / `.modelica` cache / Simulate hook) lands in #86.
 */

import * as vscode from "vscode";

import { log } from "../logger.js";
import type {
  ExtensionToWebview,
  TracePayload,
  WebviewToExtension,
} from "../webview/postprocessing-protocol.js";
import { addCachedResult, importResults, resolveResultPath } from "./add-result.js";
import { ResultCache, type ResultReader } from "./result-cache.js";
import {
  addPlotCard,
  addTrace,
  deleteCard,
  parseResultViewDoc,
  removeTrace,
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
  ) {}

  static register(
    context: vscode.ExtensionContext,
    ensureClient: () => Promise<ResultReader>,
  ): vscode.Disposable {
    const provider = new ResultViewEditorProvider(context.extensionUri, ensureClient);
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
    const cache = new ResultCache(this.ensureClient);

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

      const hasTraces = doc.cards.some((c) => (c.traces?.length ?? 0) > 0);
      if (!hasTraces) return;

      post({ type: "loading", area: "plots", busy: true });
      try {
        const traceData = await buildTraceData(doc);
        if (myGen === generation) post({ type: "doc", doc, traceData });
      } catch (err) {
        post({ type: "status", message: (err as Error).message, error: true });
      } finally {
        if (myGen === generation) post({ type: "loading", area: "plots", busy: false });
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
          applyDocEdit(deleteCard(parseResultViewDoc(document.getText()), msg.cardId));
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

        // removeResult / renameResult land in #87.
        default:
          return;
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
      post({ type: "variables", resultId: msg.resultId, error: "unknown result" });
      return;
    }
    const filePath = resolveResultPath(document.uri, result.path);
    try {
      const vars = await cache.variables(filePath);
      post({ type: "variables", resultId: msg.resultId, vars });
    } catch (err) {
      post({ type: "variables", resultId: msg.resultId, error: (err as Error).message });
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "postprocessing.js"),
    );
    // esbuild collects every `import "*.css"` in the bundle (Web Awesome's
    // theme + our VSCode bridge, via ui-common/webawesome-setup) into a
    // sibling `postprocessing.css`. We <link> to it via the webview cspSource.
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "postprocessing.css"),
    );
    const nonce = randomNonce();
    const csp = [
      `default-src 'none'`,
      `script-src 'nonce-${nonce}'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `img-src ${webview.cspSource} data: blob:`,
      `font-src ${webview.cspSource} data:`,
    ].join("; ");
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>Modelica results</title>
    <link rel="stylesheet" href="${stylesUri}" />
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden; }
    </style>
  </head>
  <body>
    <om-result-view-root></om-result-view-root>
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

function randomNonce(): string {
  let s = "";
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}
