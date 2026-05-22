/**
 * Browser entry point for the postprocessing webview. Bundled by esbuild into
 * `out/postprocessing.js` and loaded by `ResultViewEditorProvider`'s HTML, which
 * drops `<om-result-view-root>` into its body.
 *
 * `<om-result-view-root>` is the bridge: the only place that touches the VSCode
 * webview API. It owns the `postMessage` round-trip and (later) provides Lit
 * contexts to the `result-ui` components. This skeleton slice (#83) renders a
 * placeholder summarising the parsed document to prove the round-trip; the real
 * results rail + plot cards (`@modelica-wrapper/result-ui`) mount here in #84.
 */

import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";

// Boot Web Awesome's theme + the VSCode-token bridge (side-effect import). Also
// what makes esbuild emit `out/postprocessing.css`, which the host <link>s to.
import "@modelica-wrapper/ui-common/webawesome-setup";

import { omTokens } from "@modelica-wrapper/ui-common";
import type { ResultViewDoc } from "@modelica-wrapper/omc-client";

import type {
  ExtensionToWebview,
  WebviewToExtension,
} from "./postprocessing-protocol.js";

interface VsCodeApi {
  postMessage(msg: WebviewToExtension): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

@customElement("om-result-view-root")
export class OmResultViewRoot extends LitElement {
  static override styles = [
    omTokens,
    css`
      :host {
        display: block;
        height: 100%;
        box-sizing: border-box;
        padding: var(--om-space-xl);
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size, 13px);
        color: var(--vscode-foreground);
      }
      h1 {
        margin: 0 0 var(--om-space-sm);
        font-size: var(--om-title-size);
        font-weight: 600;
      }
      p {
        margin: var(--om-space-xs) 0;
        color: var(--vscode-descriptionForeground);
      }
      .counts {
        display: flex;
        gap: var(--om-space-md);
        margin: var(--om-space-lg) 0;
      }
      .count {
        border: 1px solid var(--vscode-panel-border);
        border-radius: var(--om-radius-md);
        padding: var(--om-space-sm) var(--om-space-lg);
        min-width: 64px;
      }
      .count .n {
        font-size: 1.6em;
        font-weight: 600;
      }
      .count .label {
        color: var(--vscode-descriptionForeground);
        font-size: var(--om-description-size);
      }
      .note {
        margin-top: var(--om-space-lg);
        font-size: var(--om-description-size);
        color: var(--vscode-descriptionForeground);
      }
    `,
  ];

  private readonly vscode = acquireVsCodeApi();

  @state() private doc: ResultViewDoc | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("message", this.onMessage);
    this.vscode.postMessage({ type: "ready" });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("message", this.onMessage);
  }

  private readonly onMessage = (e: MessageEvent<ExtensionToWebview>): void => {
    const msg = e.data;
    if (msg.type === "doc") {
      this.doc = msg.doc;
    }
  };

  override render(): TemplateResult {
    if (!this.doc) {
      return html`<p>Loading…</p>`;
    }
    const results = this.doc.results.length;
    const cards = this.doc.cards.length;
    return html`
      <h1>Postprocessing</h1>
      <p>Collect <code>.mat</code> results and overlay their trajectories.</p>
      <div class="counts">
        <div class="count"><div class="n">${results}</div><div class="label">results</div></div>
        <div class="count"><div class="n">${cards}</div><div class="label">cards</div></div>
      </div>
      <div class="note">
        Results rail and plot cards arrive next. This view is the editor skeleton —
        it round-trips the <code>.omresults</code> document with the host.
      </div>
    `;
  }
}
