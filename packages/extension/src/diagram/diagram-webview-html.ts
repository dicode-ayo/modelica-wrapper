import * as vscode from "vscode";

import { randomNonce } from "../webview/nonce.js";

/**
 * Build the CSP-locked HTML that boots the diagram-ui bundle (`out/webview.js`
 * + `out/webview.css`, root `<om-webview-root>`). Shared by the diagram
 * `WebviewPanel` and the `modelica.diagram` custom editor so both surfaces
 * load the identical webview.
 */
export function renderDiagramWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  className: string,
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "out", "webview.js"),
  );
  // esbuild collects every `import "*.css"` in the webview bundle (Web
  // Awesome's theme + our VSCode bridge) into a sibling `webview.css`; it is
  // <link>ed via the webview's cspSource.
  const stylesUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "out", "webview.css"),
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
    <title>Modelica diagram: ${escapeHtml(className)}</title>
    <link rel="stylesheet" href="${stylesUri}" />
    <style>
      html, body { margin: 0; height: 100%; background: #f7f7f8; overflow: hidden; }
    </style>
  </head>
  <body>
    <om-webview-root></om-webview-root>
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
