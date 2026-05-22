/**
 * `ResultViewEditorProvider` — the custom editor behind `*.omresults`
 * postprocessing documents, sibling to the diagram's `DiagramPanel`.
 *
 * It renders a CSP-locked webview that loads the standalone `out/postprocessing`
 * bundle (root `<om-result-view-root>`), parses the document with the pure
 * `parseResultViewDoc`, and pushes it down. This is the skeleton slice (#83):
 * the document round-trips (open → `ready` → `doc`, and re-syncs on edit) but no
 * `.mat` data is read yet — that's #84. Edit/add messages from the webview are
 * accepted but not yet handled.
 */

import * as vscode from "vscode";

import type {
  ExtensionToWebview,
  WebviewToExtension,
} from "../webview/postprocessing-protocol.js";
import { parseResultViewDoc } from "./result-doc.js";

export const RESULT_VIEW_VIEW_TYPE = "modelica.resultView";

export class ResultViewEditorProvider
  implements vscode.CustomTextEditorProvider
{
  private constructor(private readonly extensionUri: vscode.Uri) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new ResultViewEditorProvider(context.extensionUri);
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

    const post = (msg: ExtensionToWebview): void => {
      void webviewPanel.webview.postMessage(msg);
    };

    const sync = (): void => {
      // Pure parse; never throws. `.mat` trajectories are read in #84, so
      // `traceData` is empty for now.
      const doc = parseResultViewDoc(document.getText());
      post({ type: "doc", doc, traceData: {} });
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) sync();
    });
    webviewPanel.onDidDispose(() => changeSub.dispose());

    webviewPanel.webview.onDidReceiveMessage((msg: WebviewToExtension) => {
      switch (msg.type) {
        case "ready":
          sync();
          return;
        // Edit / add / data-fetch messages land in #84 / #85.
        default:
          return;
      }
    });
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
