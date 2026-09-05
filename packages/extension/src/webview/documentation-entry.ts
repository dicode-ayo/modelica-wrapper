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
import type {
  DocumentationChangeDetail,
  DocumentationOpenLinkDetail,
} from "@dicode/documentation-ui";
import {
  hasInterfaceSections,
  type DocumentationInterface,
} from "@dicode/documentation-ui/interface-model";
import { LitElement, html, nothing, type TemplateResult } from "lit";
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
  @state() private resources: Record<string, string> = {};
  @state() private interface: DocumentationInterface | undefined = undefined;
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
        this.resources = msg.resources;
        this.info = msg.info;
        this.readOnly = msg.readOnly;
        // Cleared here; the interface arrives in its own follow-up message so a
        // stale table never shows against freshly reloaded HTML.
        this.interface = undefined;
        this.error = null;
        return;
      case "interface":
        this.interface = msg.interface;
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

  private readonly onEditSource = (): void => {
    this.vscode.postMessage({ type: "editSource" });
  };

  private readonly onOpenLink = (
    e: CustomEvent<DocumentationOpenLinkDetail>,
  ): void => {
    this.vscode.postMessage({ type: "openLink", href: e.detail.href });
  };

  override render(): TemplateResult {
    // Keep the error node always present: a leading `${…}` before an element
    // with attribute bindings can scramble those bindings (the Lit
    // leading-interpolation gotcha).
    return html`
      <div class="om-doc-host-error" ?hidden=${this.error === null}>
        ${this.error}
      </div>
      <om-documentation-editor
        .info=${this.info}
        .resources=${this.resources}
        ?readOnly=${this.readOnly}
        external-source
        host-scroll
        @om-documentation-change=${this.onChange}
        @om-documentation-edit-source=${this.onEditSource}
        @om-documentation-open-link=${this.onOpenLink}
      ></om-documentation-editor>
      ${
        hasInterfaceSections(this.interface)
          ? html`<om-documentation-interface
              .model=${this.interface}
              @om-documentation-open-link=${this.onOpenLink}
            ></om-documentation-interface>`
          : nothing
      }
      <style>
        om-documentation-root {
          --om-doc-page-pad: 1rem;
          display: flex;
          flex-direction: column;
          block-size: 100%;
          overflow-y: auto;
        }
        om-documentation-root > om-documentation-editor {
          flex: 1 0 auto;
          min-inline-size: 0;
        }
        om-documentation-root > om-documentation-interface {
          flex: none;
          padding-block: 0 var(--om-doc-page-pad);
          padding-inline: var(--om-doc-page-pad);
          border-block-start: 1px solid
            var(--vscode-editorWidget-border, transparent);
        }
        om-documentation-root .om-doc-host-error {
          flex: none;
          padding: 0.5rem var(--om-doc-page-pad);
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
