/**
 * Browser entry point for the documentation webview. Bundled by esbuild into
 * `out/documentation.js` and loaded by `DocumentationEditorProvider`'s HTML,
 * which drops `<om-documentation-root>` into its body.
 *
 * `<om-documentation-root>` is the bridge to the VSCode webview API: it acquires
 * the API, posts `ready`, feeds the class's `info` into `<om-documentation-editor>`
 * from `@dicode/documentation-ui`, and forwards that element's
 * `om-documentation-change` back to the host as an `edit`. The editor itself is a
 * pure renderer with no VSCode dependency, so the same element serves a web
 * client.
 *
 * Renders into light DOM so the editor (also light-DOM, for ProseMirror's sake)
 * mounts in the document rather than nested shadow roots.
 */

import "@dicode/documentation-ui";
import type { DocumentationChangeDetail } from "@dicode/documentation-ui";
import { LitElement, html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";

import type {
  DocExtensionToWebview,
  DocWebviewToExtension,
} from "./documentation-protocol.js";
import { getVsCodeApi } from "./vscode-api.js";

@customElement("om-documentation-root")
export class OmDocumentationRoot extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @state() private info = "";
  @state() private readOnly = false;
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
        this.info = msg.info;
        this.readOnly = msg.readOnly;
        this.error = null;
        return;
      case "error":
        this.error = msg.message;
        return;
    }
  };

  private readonly onChange = (
    e: CustomEvent<DocumentationChangeDetail>,
  ): void => {
    this.vscode.postMessage({ type: "edit", info: e.detail.info });
  };

  override render(): TemplateResult {
    return html`
      ${this.error !== null
        ? html`<div class="om-doc-host-error">${this.error}</div>`
        : null}
      <om-documentation-editor
        .info=${this.info}
        ?readOnly=${this.readOnly}
        @om-documentation-change=${this.onChange}
      ></om-documentation-editor>
      <style>
        om-documentation-root {
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        om-documentation-root > om-documentation-editor {
          flex: 1 1 auto;
          min-height: 0;
        }
        om-documentation-root .om-doc-host-error {
          flex: 0 0 auto;
          padding: 0.5rem 1rem;
          color: var(--vscode-errorForeground);
        }
      </style>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-documentation-root": OmDocumentationRoot;
  }
}
