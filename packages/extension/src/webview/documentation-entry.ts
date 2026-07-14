/**
 * Browser entry point for the documentation webview. Bundled by esbuild into
 * `out/documentation.js` and loaded by `DocumentationEditorProvider`'s HTML,
 * which drops `<om-documentation-root>` into its body.
 *
 * `<om-documentation-root>` is the bridge to the VSCode webview API: it acquires
 * the API, posts `ready`, and renders the class's `Documentation(info=…)` HTML.
 * The HTML is sanitized before it reaches the DOM — the host CSP already makes
 * any embedded script inert, and DOMPurify strips it out entirely so no active
 * markup survives even that.
 */

import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

import type {
  DocExtensionToWebview,
  DocWebviewToExtension,
} from "./documentation-protocol.js";
import { sanitizeDoc, type SanitizedDoc } from "./documentation-sanitize.js";
import { getVsCodeApi } from "./vscode-api.js";

@customElement("om-documentation-root")
export class OmDocumentationRoot extends LitElement {
  static override styles = css`
    :host {
      --om-doc-gap: 0.75rem;
      --om-doc-pad: 1.5rem;
      --om-doc-measure: 48rem;
      display: block;
      height: 100%;
      overflow: auto;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .doc {
      max-width: var(--om-doc-measure);
      margin: 0 auto;
      padding: var(--om-doc-pad);
      line-height: 1.5;
    }
    .doc :first-child {
      margin-block-start: 0;
    }
    .doc p,
    .doc ul,
    .doc ol,
    .doc table {
      margin-block: var(--om-doc-gap);
    }
    .doc a {
      color: var(--vscode-textLink-foreground);
    }
    .doc code,
    .doc pre {
      font-family: var(--vscode-editor-font-family, monospace);
      background: var(--vscode-textCodeBlock-background);
    }
    .doc pre {
      padding: var(--om-doc-gap);
      overflow-x: auto;
    }
    .doc code {
      padding: 0 0.25rem;
    }
    .doc img {
      max-width: 100%;
    }
    .doc table {
      border-collapse: collapse;
    }
    .doc th,
    .doc td {
      border: 1px solid var(--vscode-editorWidget-border, currentColor);
      padding: 0.25rem 0.5rem;
    }
    .empty,
    .error {
      padding: var(--om-doc-pad);
      color: var(--vscode-descriptionForeground);
    }
    .error {
      color: var(--vscode-errorForeground);
    }
  `;

  @state() private doc: SanitizedDoc | null = null;
  @state() private error: string | null = null;

  private readonly vscode = getVsCodeApi<DocWebviewToExtension>();

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("message", this.onMessage);
    this.vscode.postMessage({ type: "ready" });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("message", this.onMessage);
  }

  private readonly onMessage = (
    e: MessageEvent<DocExtensionToWebview>,
  ): void => {
    const msg = e.data;
    if (!msg || typeof msg !== "object" || !("type" in msg)) return;
    switch (msg.type) {
      case "doc":
        this.doc = sanitizeDoc(msg.info);
        this.error = null;
        return;
      case "error":
        this.error = msg.message;
        return;
    }
  };

  override render(): TemplateResult {
    if (this.error !== null) {
      return html`<div class="error">${this.error}</div>`;
    }
    if (this.doc === null) {
      return html`<div class="empty">Loading documentation…</div>`;
    }
    if (this.doc.isEmpty) {
      return html`<div class="empty">This class has no documentation.</div>`;
    }
    return html`<article class="doc">${unsafeHTML(this.doc.html)}</article>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-documentation-root": OmDocumentationRoot;
  }
}
