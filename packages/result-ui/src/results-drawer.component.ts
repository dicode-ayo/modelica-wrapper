import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { omTokens } from "@dicode/ui-common";

import { fireEvent } from "./events.js";
import type { ResultRef, ResultSource } from "./types.js";
import "./icon-button.component.js";

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
        font-size: var(--om-qualifier-size);
        text-transform: uppercase;
        letter-spacing: 0.07em;
        font-weight: 700;
        color: var(--vscode-descriptionForeground);
      }
      header button {
        font: inherit;
        font-size: var(--om-qualifier-size);
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
        background: var(
          --vscode-editor-inactiveSelectionBackground,
          rgba(128, 128, 128, 0.12)
        );
      }
      .chip.missing {
        opacity: 0.65;
      }
      .chip .label {
        font-weight: var(--om-title-weight);
        font-size: var(--om-description-size);
      }
      .label-row {
        display: flex;
        align-items: center;
        gap: var(--om-space-xs);
        padding-inline-end: var(--om-space-xl);
      }
      .chip .meta {
        margin-top: var(--om-space-2xs);
        font-size: var(--om-qualifier-size);
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
      .missing-badge {
        background: var(--vscode-statusBarItem-errorBackground, #c72e0f);
        color: var(--vscode-statusBarItem-errorForeground, #fff);
      }
      .rename-icon {
        visibility: hidden;
      }
      .chip:hover .rename-icon {
        visibility: visible;
      }
      .rename-input {
        font: inherit;
        font-weight: var(--om-title-weight);
        font-size: var(--om-description-size);
        background: var(--vscode-input-background, transparent);
        border: 1px solid var(--vscode-focusBorder, var(--vscode-panel-border));
        border-radius: var(--om-radius-sm);
        color: var(--vscode-input-foreground, var(--vscode-foreground));
        padding: 1px 3px;
        width: calc(100% - var(--om-space-xl));
      }
      .remove {
        position: absolute;
        top: var(--om-space-2xs);
        right: var(--om-space-2xs);
      }
      .empty {
        padding: var(--om-space-lg) var(--om-space-md);
        color: var(--vscode-descriptionForeground);
        font-size: var(--om-qualifier-size);
      }
    `,
  ];

  @property({ attribute: false }) results: ResultRef[] = [];
  @property({ attribute: false }) missingResultIds: string[] = [];

  @state() private editingId: string | null = null;

  override updated(): void {
    if (this.editingId !== null) {
      const input =
        this.renderRoot.querySelector<HTMLInputElement>(".rename-input");
      input?.focus();
    }
  }

  override render(): TemplateResult {
    return html`
      <header>
        <span class="title">Results ${this.results.length}</span>
        <button
          title="Add a .mat result file"
          @click=${() => fireEvent(this, "om-add-result", { via: "import" })}
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
          ? html`<div class="empty">
              No results. Add a <code>.mat</code> file, or run Simulate from a
              diagram.
            </div>`
          : this.results.map((r) => this.chip(r))}
      </div>
    `;
  }

  private chip(r: ResultRef): TemplateResult {
    const when = r.createdAt ? new Date(r.createdAt).toLocaleTimeString() : "";
    const isMissing = this.missingResultIds.includes(r.id);
    const isEditing = this.editingId === r.id;

    return html`
      <div class=${`chip${isMissing ? " missing" : ""}`}>
        <om-icon-button
          class="remove"
          label="Remove from view"
          @click=${() =>
            fireEvent(this, "om-remove-result", { resultId: r.id })}
        >
          ✕
        </om-icon-button>
        <div class="label-row">
          ${isEditing
            ? html`<input
                class="rename-input"
                .value=${r.label}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter") {
                    this.saveRenameFromInput(r, e.target as HTMLInputElement);
                  } else if (e.key === "Escape") {
                    this.editingId = null;
                  }
                }}
                @blur=${(e: Event) =>
                  this.saveRenameFromInput(r, e.target as HTMLInputElement)}
              />`
            : html`
                <span class="label">${r.label}</span>
                <om-icon-button
                  class="rename-icon"
                  label="Rename"
                  @click=${() => {
                    this.editingId = r.id;
                  }}
                >
                  ✎
                </om-icon-button>
              `}
        </div>
        <div class="meta">
          <span class="badge">${SOURCE_LABEL[r.source]}</span>
          ${isMissing
            ? html`<span class="badge missing-badge">missing</span>`
            : nothing}
          ${r.model ? html`<span>${r.model}</span>` : nothing}
          ${when ? html`<span>· ${when}</span>` : nothing}
        </div>
      </div>
    `;
  }

  private saveRenameFromInput(r: ResultRef, input: HTMLInputElement): void {
    // Guard against the blur that fires when the input is removed from the DOM
    // after an Enter keydown: Enter clears editingId first, so blur re-enters
    // here with editingId already null and returns without a second emit.
    if (this.editingId === null) return;
    const label = input.value.trim() || r.label;
    this.editingId = null;
    fireEvent(this, "om-rename-result", { resultId: r.id, label });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-results-drawer": OmResultsDrawer;
  }
}
