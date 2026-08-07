import * as vscode from "vscode";

import { renderWebviewPage } from "../webview/webview-page.js";

/**
 * Build the CSP-locked HTML that boots the documentation-ui bundle
 * (`out/documentation.js`, root `<om-documentation-root>`) for the
 * `modelica.documentation` custom editor. The bundle injects its own `<style>`
 * (allowed by `style-src 'unsafe-inline'`), so no sibling `.css` is linked.
 *
 * `script-src` is nonce-only (no `'unsafe-inline'`) as a backstop, but the
 * webview never injects the raw `Documentation` string: TipTap parses it against
 * an explicit schema and only the resulting ProseMirror document reaches the DOM.
 */
export function renderDocumentationWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  className: string,
): string {
  return renderWebviewPage({
    webview,
    extensionUri,
    entry: "documentation",
    title: `Modelica documentation: ${className}`,
    root: "<om-documentation-root></om-documentation-root>",
    bodyStyle: "html, body { margin: 0; height: 100%; }",
  });
}
