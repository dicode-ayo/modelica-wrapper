/**
 * `<om-cards-list>` — the scrollable column of plot cards, with "+ Plot"
 * inserters between and after cards (and an empty state when there are none).
 * Pure layout: it maps each card to an `<om-result-plot-card>` and routes the
 * matching trace data by index.
 */

import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

import { omTokens } from "@modelica-wrapper/ui-common";

import { fireEvent } from "./events.js";
import type { Card, ResultRef, TracePayload } from "./types.js";
import "./result-plot-card.component.js";

@customElement("om-cards-list")
export class OmCardsList extends LitElement {
  static override styles = [
    omTokens,
    css`
      :host {
        display: block;
        height: 100%;
        overflow-y: auto;
        padding: var(--om-space-lg);
        box-sizing: border-box;
      }
      .insert {
        display: flex;
        justify-content: center;
        margin: var(--om-space-xs) 0 var(--om-space-md);
      }
      .insert button,
      .empty button {
        font: inherit;
        font-size: 0.85em;
        cursor: pointer;
        padding: 1px var(--om-space-lg);
        color: var(--vscode-descriptionForeground);
        background: var(--vscode-editor-background, transparent);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 10px;
      }
      .insert button:hover,
      .empty button:hover {
        color: var(--vscode-foreground);
        border-color: var(--vscode-button-background);
        background: var(--vscode-list-hoverBackground, transparent);
      }
      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--om-space-md);
        padding: 48px 0;
        color: var(--vscode-descriptionForeground);
        font-size: 0.9em;
      }
    `,
  ];

  @property({ attribute: false }) cards: Card[] = [];
  @property({ attribute: false }) results: ResultRef[] = [];
  @property({ attribute: false }) traceData: Record<number, TracePayload[]> = {};
  @property({ attribute: false }) variablesByResult: Record<string, string[]> = {};

  private addPlot(afterIndex: number): void {
    fireEvent(this, "om-add-plot", { afterIndex });
  }

  override render(): TemplateResult {
    if (this.cards.length === 0) {
      return html`
        <div class="empty">
          <span>No plots yet</span>
          <button @click=${() => this.addPlot(-1)}>+ Add Plot</button>
        </div>
      `;
    }
    return html`
      ${this.cards.map(
        (card, i) => html`
          <om-result-plot-card
            .cardIndex=${i}
            .card=${card}
            .results=${this.results}
            .traces=${this.traceData[i] ?? []}
            .variablesByResult=${this.variablesByResult}
          ></om-result-plot-card>
          <div class="insert">
            <button @click=${() => this.addPlot(i)}>+ Plot</button>
          </div>
        `,
      )}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-cards-list": OmCardsList;
  }
}
