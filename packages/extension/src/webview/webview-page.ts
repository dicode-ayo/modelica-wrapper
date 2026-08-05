import * as vscode from "vscode";

/**
 * Every bundle esbuild produces for a webview to boot from `out/`
 * (`esbuild.config.mjs`'s `webviewConfig`, `documentationConfig`,
 * `libraryViewConfig`, `postprocessingConfig`). `webview-page.test.ts`
 * cross-checks {@link ENTRY_BUNDLE}'s filenames against that config, so a
 * renamed outfile fails a test even though the config itself isn't TypeScript.
 */
export type WebviewEntry =
  | "webview"
  | "documentation"
  | "library-view"
  | "postprocessing";

export const ENTRY_BUNDLE: Record<WebviewEntry, string> = {
  webview: "webview.js",
  documentation: "documentation.js",
  "library-view": "library-view.js",
  postprocessing: "postprocessing.js",
};

/** Random nonce for a webview's Content-Security-Policy `script-src`. */
export function randomNonce(): string {
  let s = "";
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const DEFAULT_BODY_STYLE =
  "html, body { margin: 0; height: 100%; overflow: hidden; }";

export interface RenderWebviewPageOptions {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  entry: WebviewEntry;
  title: string;
  /** The bundle's root custom element, e.g. `<om-webview-root></om-webview-root>`. */
  root: string;
  /** Link the sibling `.css` esbuild collects for this bundle's `import "*.css"`s. */
  stylesheet?: boolean;
  /** `html, body` style block; defaults to a full-height, non-scrolling page. */
  bodyStyle?: string;
}

/**
 * Build the CSP-locked HTML shell every webview boots from: a nonce-gated
 * `<script type="module">` loading its esbuild bundle, an escaped `<title>`,
 * and the bundle's own root custom element.
 */
export function renderWebviewPage(opts: RenderWebviewPageOptions): string {
  const bundle = ENTRY_BUNDLE[opts.entry];
  const scriptUri = opts.webview.asWebviewUri(
    vscode.Uri.joinPath(opts.extensionUri, "out", bundle),
  );
  const nonce = randomNonce();
  const csp = [
    `default-src 'none'`,
    `script-src 'nonce-${nonce}'`,
    `style-src ${opts.webview.cspSource} 'unsafe-inline'`,
    `img-src ${opts.webview.cspSource} data: blob:`,
    `font-src ${opts.webview.cspSource} data:`,
  ].join("; ");
  const stylesLink = opts.stylesheet
    ? `\n    <link rel="stylesheet" href="${opts.webview.asWebviewUri(
        vscode.Uri.joinPath(
          opts.extensionUri,
          "out",
          bundle.replace(/\.js$/, ".css"),
        ),
      )}" />`
    : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>${escapeHtml(opts.title)}</title>${stylesLink}
    <style>
      ${opts.bodyStyle ?? DEFAULT_BODY_STYLE}
    </style>
  </head>
  <body>
    ${opts.root}
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}

export interface RenderPlaceholderPageOptions {
  cspSource: string;
  title: string;
  message: string;
}

/**
 * A script-free placeholder shell for an editor with no real class open yet:
 * a centered message under a reduced CSP with no `script-src`/`img-src`,
 * since nothing here loads a bundle.
 */
export function renderPlaceholderPage(
  opts: RenderPlaceholderPageOptions,
): string {
  const csp = [
    `default-src 'none'`,
    `style-src ${opts.cspSource} 'unsafe-inline'`,
  ].join("; ");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>${escapeHtml(opts.title)}</title>
    <style>
      body {
        margin: 0;
        height: 100dvh;
        display: grid;
        place-items: center;
        font-family: var(--vscode-font-family);
        color: var(--vscode-descriptionForeground);
      }
      p { max-width: 32rem; padding: 1rem; text-align: center; }
    </style>
  </head>
  <body>
    <p>${escapeHtml(opts.message)}</p>
  </body>
</html>`;
}
