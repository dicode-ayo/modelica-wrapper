import * as vscode from "vscode";

import { randomNonce } from "../webview/nonce.js";

/**
 * Build the CSP-locked HTML that boots the documentation-ui bundle
 * (`out/documentation.js`, root `<om-documentation-root>`) for the
 * `modelica.documentation` custom editor. The bundle injects its own `<style>`
 * (allowed by `style-src 'unsafe-inline'`), so no sibling `.css` is linked.
 *
 * `script-src` is nonce-only (no `'unsafe-inline'`), so any `<script>` or
 * inline handler carried in the rendered `Documentation` HTML is inert — the
 * webview sanitizes on top of that, not instead of it.
 */
export function renderDocumentationWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  className: string,
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "out", "documentation.js"),
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
    <title>Modelica documentation: ${escapeHtml(className)}</title>
    <style>
      html, body { margin: 0; height: 100%; }
    </style>
  </head>
  <body>
    <om-documentation-root></om-documentation-root>
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
