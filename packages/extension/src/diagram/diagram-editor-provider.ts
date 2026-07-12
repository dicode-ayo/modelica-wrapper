import * as vscode from "vscode";

import type { OmcClient } from "@dicode/omc-client";

import { log } from "../logger.js";
import { qualifiedNameFromUri } from "../source-provider.js";
import type {
  ExtensionToWebview,
  WebviewToExtension,
} from "../webview/protocol.js";

import { renderDiagramWebviewHtml } from "./diagram-webview-html.js";
import { fetchDiagramLayout } from "./open-diagram.js";

export const DIAGRAM_VIEW_TYPE = "modelica.diagram";

/**
 * Resolve the Modelica class a `.mo` document stands for. The
 * `modelica-source:` virtual scheme encodes the dotted name in its path; a
 * real `file:` `.mo` carries no such mapping, so it returns `undefined` and
 * the editor shows a placeholder rather than guessing a class.
 */
export function classNameFromDocument(
  document: vscode.TextDocument,
): string | undefined {
  return qualifiedNameFromUri(document.uri);
}

/**
 * Read-only diagram custom editor: a `CustomTextEditorProvider` bound to
 * `*.mo` that renders a class's diagram from OMC. It shares the diagram-ui
 * webview bundle with `DiagramPanel` but wires no mutation handlers, so
 * webview-side gestures do not round-trip to OMC.
 */
export class DiagramEditorProvider implements vscode.CustomTextEditorProvider {
  private constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly ensureClient: () => Promise<OmcClient>,
  ) {}

  static register(
    context: vscode.ExtensionContext,
    ensureClient: () => Promise<OmcClient>,
  ): vscode.Disposable {
    const provider = new DiagramEditorProvider(
      context.extensionUri,
      ensureClient,
    );
    return vscode.window.registerCustomEditorProvider(
      DIAGRAM_VIEW_TYPE,
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
    resolveDiagramEditor(
      webviewPanel,
      this.extensionUri,
      this.ensureClient,
      classNameFromDocument(document),
    );
  }
}

/**
 * Wire a resolved diagram editor onto its webview panel. Extracted from the
 * provider so the read-only render path is unit-testable without the
 * custom-editor registration machinery.
 *
 * An `undefined` className (a real `file:` `.mo`, whose class mapping is not
 * yet resolved) renders a static placeholder instead of the diagram bundle.
 */
export function resolveDiagramEditor(
  webviewPanel: vscode.WebviewPanel,
  extensionUri: vscode.Uri,
  ensureClient: () => Promise<OmcClient>,
  className: string | undefined,
): void {
  const { webview } = webviewPanel;
  webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, "out")],
  };

  if (className === undefined) {
    webview.html = renderPlaceholderHtml(webview.cspSource);
    return;
  }

  webview.html = renderDiagramWebviewHtml(webview, extensionUri, className);

  // The webview posts `ready` once its bundle mounts; messages queued before
  // then are flushed on that signal (mirrors `DiagramPanel`'s handshake).
  let ready = false;
  const pending: ExtensionToWebview[] = [];
  const send = (msg: ExtensionToWebview): void => {
    if (!ready) {
      pending.push(msg);
      return;
    }
    void webview.postMessage(msg);
  };

  const sub = webview.onDidReceiveMessage((msg: WebviewToExtension) => {
    // Read-only: only the readiness handshake is honoured. Edit and action
    // messages from the webview are ignored, so nothing round-trips to OMC.
    if (msg.type !== "ready") return;
    ready = true;
    for (const m of pending) void webview.postMessage(m);
    pending.length = 0;
  });
  webviewPanel.onDidDispose(() => sub.dispose());

  void (async (): Promise<void> => {
    try {
      const client = await ensureClient();
      const layout = await fetchDiagramLayout(client, className);
      send({ type: "init", layout, className });
    } catch (err) {
      const message = `Failed to render diagram for ${className}: ${(err as Error).message}`;
      send({ type: "error", message });
      log.warn("diagramEditor", message);
    }
  })();
}

function renderPlaceholderHtml(cspSource: string): string {
  const csp = [
    `default-src 'none'`,
    `style-src ${cspSource} 'unsafe-inline'`,
  ].join("; ");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>Modelica diagram</title>
    <style>
      body {
        margin: 0;
        height: 100vh;
        display: grid;
        place-items: center;
        font-family: var(--vscode-font-family);
        color: var(--vscode-descriptionForeground);
      }
      p { max-width: 32rem; padding: 1rem; text-align: center; }
    </style>
  </head>
  <body>
    <p>Open a Modelica class from the library sidebar to see its diagram.</p>
  </body>
</html>`;
}
