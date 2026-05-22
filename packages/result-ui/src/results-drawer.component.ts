/**
 * `<om-results-drawer>` — the results rail: one chip per `.mat` result (label,
 * model, source badge, timestamp) with a remove button, plus the "add result"
 * controls. The host owns the actual add flows (file dialog / `.modelica`
 * cache); this just emits `om-add-result { via }`. Rename lands in the polish
 * pass (#86); the chip remove emits `om-remove-result`.
 */

import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

import { omTokens } from "@modelica-wrapper/ui-common";

import { fireEvent } from "./events.js";
import type { ResultRef, ResultSource } from "./types.js";

const SOURCE_LABEL: Record<ResultSource, string> = {
  simulate: "sim",
  import: "file",
  cache: "cache",
};

@customElement("om-results-drawer")
export class OmResultsDrawer extends LitElement {
  static override styles = [
    omTokens,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        box-sizing: border-box;
      }
      header {
        display: flex;
        align-items: center;
        gap: var(--om-space-sm);
        padding: var(--om-space-sm) var(--om-space-md);
        border-bottom: 1px solid var(--vscode-panel-border);
      }
      header .title {
        flex: 1;
        font-size: 0.78em;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        font-weight: 700;
        color: var(--vscode-descriptionForeground);
      }
      header button {
        font: inherit;
        font-size: 0.82em;
        cursor: pointer;
        padding: 1px var(--om-space-sm);
        color: var(--vscode-foreground);
        background: var(--vscode-button-secondaryBackground, transparent);
        border: 1px solid var(--vscode-panel-border);
        border-radius: var(--om-radius-sm);
      }
      header button:hover {
        background: var(--vscode-list-hoverBackground, transparent);
      }
      .list {
        flex: 1;
        overflow-y: auto;
        padding: var(--om-space-sm);
        display: flex;
        flex-direction: column;
        gap: var(--om-space-xs);
      }
      .chip {
        position: relative;
        padding: var(--om-space-sm);
        border-radius: var(--om-radius-md);
        background: var(--vscode-editor-inactiveSelectionBackground, rgba(128, 128, 128, 0.12));
      }
      .chip .label {
        font-weight: 600;
        font-size: 0.88em;
        padding-right: 16px;
      }
      .chip .meta {
        margin-top: 2px;
        font-size: 0.8em;
        color: var(--vscode-descriptionForeground);
        display: flex;
        align-items: center;
        gap: var(--om-space-xs);
      }
      .badge {
        font-size: var(--om-badge-font-size);
        font-weight: var(--om-badge-font-weight);
        text-transform: uppercase;
        padding: 0 var(--om-space-xs);
        border-radius: var(--om-radius-sm);
        background: var(--vscode-badge-background, #4d4d4d);
        color: var(--vscode-badge-foreground, #fff);
      }
      .remove {
        position: absolute;
        top: 2px;
        right: 2px;
        border: none;
        background: transparent;
        cursor: pointer;
        color: var(--vscode-descriptionForeground);
        border-radius: var(--om-radius-sm);
        line-height: 1;
        padding: 0 2px;
      }
      .remove:hover {
        color: var(--vscode-errorForeground);
      }
      .empty {
        padding: var(--om-space-lg) var(--om-space-md);
        color: var(--vscode-descriptionForeground);
        font-size: 0.85em;
      }
    `,
  ];

  @property({ attribute: false }) results: ResultRef[] = [];

  override render(): TemplateResult {
    return html`
      <header>
        <span class="title">Results ${this.results.length}</span>
        <button
          title="Add a .mat result file"
          @click=${() => fireEvent(this, "om-add-result", { via: "pick" })}
        >
          + File…
        </button>
        <button
          title="Add from the workspace .modelica cache"
          @click=${() => fireEvent(this, "om-add-result", { via: "cache" })}
        >
          Cache…
        </button>
      </header>
      <div class="list">
        ${this.results.length === 0
          ? html`<div class="empty">No results. Add a <code>.mat</code> file, or run Simulate from a diagram.</div>`
          : this.results.map((r) => this.chip(r))}
      </div>
    `;
  }

  private chip(r: ResultRef): TemplateResult {
    const when = r.createdAt
      ? new Date(r.createdAt).toLocaleTimeString()
      : "";
    return html`
      <div class="chip">
        <button
          class="remove"
          title="Remove from view"
          @click=${() => fireEvent(this, "om-remove-result", { resultId: r.id })}
        >
          ✕
        </button>
        <div class="label">${r.label}</div>
        <div class="meta">
          <span class="badge">${SOURCE_LABEL[r.source]}</span>
          ${r.model ? html`<span>${r.model}</span>` : nothing}
          ${when ? html`<span>· ${when}</span>` : nothing}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-results-drawer": OmResultsDrawer;
  }
}
