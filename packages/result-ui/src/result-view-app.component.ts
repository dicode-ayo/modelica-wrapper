import {
  LitElement,
  css,
  html,
  nothing,
  type PropertyValues,
  type TemplateResult,
} from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { omTokens } from "@dicode/ui-common";

import type { ResultViewDoc, TracePayload } from "./types.js";
import "./icon-button.component.js";
import "./results-drawer.component.js";
import "./cards-list.component.js";

@customElement("om-result-view-app")
export class OmResultViewApp extends LitElement {
  static override styles = [
    omTokens,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size, 13px);
        color: var(--vscode-foreground);
      }
      .status-banner {
        padding: var(--om-space-xs) var(--om-space-md);
        background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
        color: var(--om-error-foreground, var(--vscode-foreground));
        font-size: var(--om-qualifier-size);
        display: flex;
        align-items: center;
        gap: var(--om-space-sm);
        border-bottom: 1px solid
          var(--vscode-inputValidation-errorBorder, #be1100);
      }
      .content {
        display: flex;
        flex: 1;
        min-height: 0;
      }
      .rail {
        width: var(--om-result-rail-size);
        min-width: var(--om-result-rail-min-size);
        flex-shrink: 0;
        border-right: 1px solid var(--vscode-panel-border);
        overflow: hidden;
      }
      .cards {
        flex: 1;
        min-width: 0;
        overflow: hidden;
      }
      .loading {
        padding: var(--om-space-xs) var(--om-space-lg);
        font-size: var(--om-qualifier-size);
        color: var(--vscode-descriptionForeground);
        border-bottom: 1px solid var(--vscode-panel-border);
      }
      .cards-wrap {
        display: flex;
        flex-direction: column;
        height: 100%;
      }
      om-cards-list {
        flex: 1;
        min-height: 0;
      }
    `,
  ];

  @property({ attribute: false }) doc: ResultViewDoc = {
    version: 1,
    results: [],
    cards: [],
  };
  /** Trace data per card, keyed by `card.id`. */
  @property({ attribute: false }) traceData: Record<string, TracePayload[]> =
    {};
  @property({ attribute: false }) variablesByResult: Record<string, string[]> =
    {};
  /** Optional spinner gating from the host. */
  @property({ type: Boolean }) plotsLoading = false;
  @property({ attribute: false }) missingResultIds: string[] = [];
  @property({ attribute: false }) statusMessage: string | null = null;

  @state() private dismissedMessage: string | null = null;

  override willUpdate(changed: PropertyValues): void {
    if (changed.has("statusMessage")) this.dismissedMessage = null;
  }

  override render(): TemplateResult {
    const showBanner =
      this.statusMessage !== null &&
      this.statusMessage !== this.dismissedMessage;
    return html`
      ${
        showBanner
          ? html`
              <div class="status-banner">
                <span>${this.statusMessage}</span>
                <om-icon-button
                  label="Dismiss"
                  @click=${() => {
                    this.dismissedMessage = this.statusMessage;
                  }}
                >
                  ✕
                </om-icon-button>
              </div>
            `
          : nothing
      }
      <div class="content">
        <div class="rail">
          <om-results-drawer
            .results=${this.doc.results}
            .missingResultIds=${this.missingResultIds}
          ></om-results-drawer>
        </div>
        <div class="cards">
          <div class="cards-wrap">
            ${
              this.plotsLoading
                ? html`<div class="loading">Fetching data…</div>`
                : nothing
            }
            <om-cards-list
              .cards=${this.doc.cards}
              .results=${this.doc.results}
              .traceData=${this.traceData}
              .variablesByResult=${this.variablesByResult}
            ></om-cards-list>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-result-view-app": OmResultViewApp;
  }
}
