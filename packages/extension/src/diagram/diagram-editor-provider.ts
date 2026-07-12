import * as vscode from "vscode";

import type { OmcClient } from "@dicode/omc-client";

import { log } from "../logger.js";
import { qualifiedNameFromUri } from "../source-provider.js";
import type { WebviewToExtension } from "../webview/protocol.js";
import { createReadyGate } from "../webview/ready-gate.js";

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
      document,
    );
  }
}

/**
 * Wire a resolved diagram editor onto its webview panel: resolve the class the
 * `.mo` document stands for, boot the diagram-ui bundle, then seed the layout
 * once the webview signals `ready`. A document whose class can't be resolved
 * renders a static placeholder instead.
 */
export function resolveDiagramEditor(
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

  const gate = createReadyGate(webview);
  const sub = webview.onDidReceiveMessage((msg: WebviewToExtension) => {
    // Read-only: only the readiness handshake is honoured. Edit and action
    // messages from the webview are ignored, so nothing round-trips to OMC.
    if (msg.type === "ready") gate.markReady();
  });
  webviewPanel.onDidDispose(() => sub.dispose());

  // The `modelica-source:` scheme encodes the class in its path — resolve it
  // synchronously so the bundle boots without an OMC round-trip.
  const fromScheme = classNameFromDocument(document);
  if (fromScheme !== undefined) {
    renderDiagram(webview, extensionUri, gate, ensureClient, fromScheme);
    return;
  }

  void (async (): Promise<void> => {
    const className = await classNameFromFile(document, ensureClient);
    if (className === undefined) {
      webview.html = renderPlaceholderHtml(webview.cspSource);
      return;
    }
    renderDiagram(webview, extensionUri, gate, ensureClient, className);
  })();
}

/** Boot the diagram bundle for `className` and seed its layout once ready. */
function renderDiagram(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  gate: ReturnType<typeof createReadyGate>,
  ensureClient: () => Promise<OmcClient>,
  className: string,
): void {
  webview.html = renderDiagramWebviewHtml(webview, extensionUri, className);
  void (async (): Promise<void> => {
    try {
      const client = await ensureClient();
      const layout = await fetchDiagramLayout(client, className);
      gate.send({ type: "init", layout, className });
    } catch (err) {
      const message = `Failed to render diagram for ${className}: ${(err as Error).message}`;
      gate.send({ type: "error", message });
      log.warn("diagramEditor", message);
    }
  })();
}

/**
 * Resolve the top-level class of an on-disk `file:` `.mo` via OMC `parseFile`,
 * which reads the file WITHOUT loading it into the symbol table. Returns the
 * first declared class, or `undefined` when the document isn't a `file:` `.mo`,
 * parsing fails, or no class is declared.
 *
 * Read-only-safe: resolving against the on-disk file only picks a class to
 * render — it never creates a second editable buffer, so the deferred `file:`
 * *edit* policy (needed once #286+ add the write path) is untouched here.
 */
async function classNameFromFile(
  document: vscode.TextDocument,
  ensureClient: () => Promise<OmcClient>,
): Promise<string | undefined> {
  const { uri } = document;
  if (uri.scheme !== "file" || !uri.path.endsWith(".mo")) return undefined;
  try {
    const client = await ensureClient();
    const { classNames } = await client.parseFile({ fileName: uri.fsPath });
    const first = classNames.at(0);
    if (first === undefined) return undefined;
    if (classNames.length > 1) {
      log.info(
        "diagramEditor",
        `${uri.fsPath} declares ${classNames.length} top-level classes; rendering ${first}`,
      );
    }
    return first;
  } catch (err) {
    log.warn(
      "diagramEditor",
      `parseFile failed for ${uri.fsPath}: ${(err as Error).message}`,
    );
    return undefined;
  }
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
