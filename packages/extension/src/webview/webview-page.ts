import * as vscode from "vscode";

export type WebviewEntry =
  | "webview"
  | "documentation"
  | "library-view"
  | "postprocessing";

interface EntryConfig {
  /** `out/<bundle>` — esbuild's `outfile` for this entry (`esbuild.config.mjs`). */
  bundle: string;
  /**
   * Whether esbuild collects a sibling `<bundle>.css`, i.e. whether this
   * entry's `*-entry.ts` imports `@dicode/ui-common/webawesome-setup`.
   */
  stylesheet: boolean;
}

/**
 * `webview-page.test.ts` cross-checks both fields of every entry here
 * against the source they're facts about — `bundle` against
 * `esbuild.config.mjs`'s own `outfile`s, `stylesheet` against whether the
 * entry file actually imports `webawesome-setup` — so either drifting from
 * its entry fails a test rather than booting a blank or 404'd webview.
 */
export const WEBVIEW_ENTRIES: Record<WebviewEntry, EntryConfig> = {
  webview: { bundle: "webview.js", stylesheet: true },
  documentation: { bundle: "documentation.js", stylesheet: false },
  "library-view": { bundle: "library-view.js", stylesheet: false },
  postprocessing: { bundle: "postprocessing.js", stylesheet: true },
};

/** Random nonce for a webview's Content-Security-Policy `script-src`. */
function randomNonce(): string {
  let s = "";
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

function escapeHtml(s: string): string {
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
  /** `html, body` style block; defaults to a full-height, non-scrolling page. */
  bodyStyle?: string;
}

/**
 * Build the CSP-locked HTML shell every webview boots from: a nonce-gated
 * `<script type="module">` loading its esbuild bundle, an escaped `<title>`,
 * and the bundle's own root custom element.
 */
export function renderWebviewPage(opts: RenderWebviewPageOptions): string {
  const { bundle, stylesheet } = WEBVIEW_ENTRIES[opts.entry];
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
  const stylesLink = stylesheet
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
