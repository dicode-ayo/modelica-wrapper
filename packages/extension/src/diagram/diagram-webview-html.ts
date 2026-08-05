import * as vscode from "vscode";

import { renderWebviewPage } from "../webview/webview-page.js";

// Diagrams render on a fixed light canvas (Modelica convention); the scene's
// stroke/fill colors assume it, so this must not follow the VSCode theme.
const DIAGRAM_CANVAS_BG = "#f7f7f8";

/**
 * Build the CSP-locked HTML that boots the diagram-ui bundle (`out/webview.js`
 * + `out/webview.css`, root `<om-webview-root>`) for the `modelica.diagram`
 * custom editor.
 */
export function renderDiagramWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  className: string,
): string {
  return renderWebviewPage({
    webview,
    extensionUri,
    entry: "webview",
    title: `Modelica diagram: ${className}`,
    root: "<om-webview-root></om-webview-root>",
    stylesheet: true,
    bodyStyle: `html, body { margin: 0; height: 100%; background: ${DIAGRAM_CANVAS_BG}; overflow: hidden; }`,
  });
}
