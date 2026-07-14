import * as vscode from "vscode";

import type { OmcClient } from "@dicode/omc-client";

import { DOCUMENTATION_VIEW_TYPE } from "../diagram/view-type.js";
import { log } from "../logger.js";
import { qualifiedNameFromUri } from "../source-provider.js";
import type {
  DocExtensionToWebview,
  DocWebviewToExtension,
} from "../webview/documentation-protocol.js";
import { createReadyGate } from "../webview/ready-gate.js";

import { renderDocumentationWebviewHtml } from "./documentation-webview-html.js";

export { DOCUMENTATION_VIEW_TYPE };

/** The subset of OMC the documentation editor reads. */
interface DocumentationClient {
  getDocumentationAnnotation(input: {
    typeName: string;
  }): Promise<{ info: string }>;
}

/**
 * Documentation custom editor: a `CustomTextEditorProvider` bound to `*.mo`
 * that renders a class's `Documentation(info="<html>…</html>")` HTML. It reads
 * the annotation from OMC and renders it, sanitized, in a webview. Editing is a
 * later surface; for now the view is read-only, so it never touches the backing
 * document.
 */
export class DocumentationEditorProvider
  implements vscode.CustomTextEditorProvider
{
  private constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly ensureClient: () => Promise<OmcClient>,
  ) {}

  static register(
    context: vscode.ExtensionContext,
    ensureClient: () => Promise<OmcClient>,
    viewType: string,
  ): vscode.Disposable {
    const provider = new DocumentationEditorProvider(
      context.extensionUri,
      ensureClient,
    );
    return vscode.window.registerCustomEditorProvider(viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    });
  }

  resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    resolveDocumentationEditor(
      webviewPanel,
      this.extensionUri,
      this.ensureClient,
      document,
    );
  }
}

/**
 * Wire a resolved documentation editor onto its webview panel: resolve the
 * class the `.mo` document stands for, boot the documentation-ui bundle, and
 * seed it with the class's `info` HTML once the webview signals `ready`. A
 * document whose class can't be resolved renders a static placeholder.
 *
 * Re-invoked by VSCode on reload, so the render restores itself from a fresh
 * OMC read with no persisted state.
 */
export function resolveDocumentationEditor(
  webviewPanel: vscode.WebviewPanel,
  extensionUri: vscode.Uri,
  ensureClient: () => Promise<OmcClient>,
  document: vscode.TextDocument,
): void {
  const { webview } = webviewPanel;
  webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, "out")],
  };

  // The `modelica-source:` scheme encodes the class in its path. A bare `file:`
  // `.mo` carries no such mapping, so it renders a placeholder rather than
  // guessing a class.
  const className = qualifiedNameFromUri(document.uri);
  if (className === undefined) {
    webview.html = renderPlaceholderHtml(webview.cspSource);
    return;
  }

  const gate = createReadyGate<DocExtensionToWebview>(webview);
  const sub = webview.onDidReceiveMessage((msg: DocWebviewToExtension) => {
    if (msg.type === "ready") gate.markReady();
  });
  webviewPanel.onDidDispose(() => sub.dispose());

  webview.html = renderDocumentationWebviewHtml(
    webview,
    extensionUri,
    className,
  );

  void (async (): Promise<void> => {
    try {
      const client: DocumentationClient = await ensureClient();
      const { info } = await client.getDocumentationAnnotation({
        typeName: className,
      });
      gate.send({ type: "doc", className, info });
    } catch (err) {
      const message = `Failed to load documentation for ${className}: ${(err as Error).message}`;
      gate.send({ type: "error", message });
      log.warn("documentationEditor", message);
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
    <title>Modelica documentation</title>
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
    <p>Open a Modelica class from the library sidebar to see its documentation.</p>
  </body>
</html>`;
}
