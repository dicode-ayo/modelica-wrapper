/**
 * `<om-result-view-app>` — top-level layout for the postprocessing view: a
 * results rail on the left, the scrollable plot-cards column on the right.
 *
 * Purely declarative: the host (via the extension bridge) sets `doc`,
 * `traceData`, and `variablesByResult`; child components emit bubbling, composed
 * events that pass straight through this element to the bridge. No state of its
 * own beyond what's handed in.
 */

import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

import { omTokens } from "@dicode/ui-common";

import type { ResultViewDoc, TracePayload } from "./types.js";
import "./results-drawer.component.js";
import "./cards-list.component.js";

@customElement("om-result-view-app")
export class OmResultViewApp extends LitElement {
  static override styles = [
    omTokens,
    css`
      :host {
        display: flex;
        height: 100%;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size, 13px);
        color: var(--vscode-foreground);
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

  override render(): TemplateResult {
    return html`
      <div class="rail">
        <om-results-drawer .results=${this.doc.results}></om-results-drawer>
      </div>
      <div class="cards">
        <div class="cards-wrap">
          ${this.plotsLoading
            ? html`<div class="loading">Fetching data…</div>`
            : nothing}
          <om-cards-list
            .cards=${this.doc.cards}
            .results=${this.doc.results}
            .traceData=${this.traceData}
            .variablesByResult=${this.variablesByResult}
          ></om-cards-list>
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
