import * as vscode from "vscode";

/**
 * Every browser bundle esbuild produces from `src/webview/<entry>-entry.ts`
 * into `out/<entry>.js` (`esbuild.config.mjs`'s `webviewConfig`,
 * `documentationConfig`, `libraryViewConfig`, `postprocessingConfig` all
 * follow this `<entry>-entry.ts` → `out/<entry>.js` naming). A typo here is
 * a compile error, not a silently-wrong URL.
 */
export type WebviewEntry =
  | "webview"
  | "documentation"
  | "library-view"
  | "postprocessing";

/** Every {@link WebviewEntry}, for callers (namely tests) that need to enumerate them. */
export const ALL_WEBVIEW_ENTRIES: readonly WebviewEntry[] = [
  "webview",
  "documentation",
  "library-view",
  "postprocessing",
];

/**
 * Entries whose `<entry>-entry.ts` imports `@dicode/ui-common/webawesome-setup`
 * — the only `import "*.css"` any entry currently pulls in, which is what
 * makes esbuild collect a sibling `out/<entry>.css`. `webview-page.test.ts`
 * checks each entry file for that import as a proxy for the actual build
 * output; a *different* CSS import landing in an entry's tree would need
 * both this set and that check updated by hand.
 */
const STYLESHEET_ENTRIES: ReadonlySet<WebviewEntry> = new Set([
  "webview",
  "postprocessing",
]);

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
  /** Escaped into `<title>`; the only field here that carries untrusted text. */
  title: string;
  /**
   * The bundle's root custom element, e.g. `<om-webview-root></om-webview-root>`.
   * Emitted raw — every caller passes a static literal, never workspace data.
   */
  root: string;
  /**
   * `html, body` style block; defaults to a full-height, non-scrolling page.
   * Emitted raw, same as {@link root}.
   */
  bodyStyle?: string;
}

/**
 * Build the CSP-locked HTML shell every webview boots from: a nonce-gated
 * `<script type="module">` loading its esbuild bundle, an escaped `<title>`,
 * and the bundle's own root custom element.
 */
export function renderWebviewPage(opts: RenderWebviewPageOptions): string {
  const bundle = `${opts.entry}.js`;
  const stylesheet = STYLESHEET_ENTRIES.has(opts.entry);
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
