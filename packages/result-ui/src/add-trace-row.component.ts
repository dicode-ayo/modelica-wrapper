/**
 * `<om-add-trace-row>` — pick a result, then drill its variables level-by-level
 * with cascading `<select>`s, and add the chosen `(result, variable)` to a plot.
 *
 * The variable hierarchy comes from {@link buildVariableTree} over the selected
 * result's flat variable list (`variablesByResult[resultId]`). The host supplies
 * that list lazily: when a result with no known variables is selected, the row
 * emits `om-request-variables` and the host pushes the list back down via the
 * `variablesByResult` property. The cascade logic itself lives in `picker.ts`
 * (pure, unit-tested); this component is the thin DOM shell.
 *
 * Properties in, events out — no host/OMC knowledge.
 */

import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { omTokens } from "@modelica-wrapper/ui-common";

import { fireEvent } from "./events.js";
import { cascadeLevels, selectedNode, withSelection } from "./picker.js";
import type { ResultRef } from "./types.js";
import { buildVariableTree, type VarNode } from "./var-tree.js";

@customElement("om-add-trace-row")
export class OmAddTraceRow extends LitElement {
  static override styles = [
    omTokens,
    css`
      :host {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--om-space-xs);
        margin-top: var(--om-space-sm);
      }
      select {
        font: inherit;
        font-size: 0.9em;
        height: 24px;
        max-width: 14em;
        padding: 0 var(--om-space-xs);
        color: var(--vscode-input-foreground, inherit);
        background: var(--vscode-input-background, #fff);
        border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, #ccc));
        border-radius: var(--om-radius-sm);
      }
      .sep {
        color: var(--vscode-descriptionForeground);
        opacity: 0.6;
      }
      button {
        font: inherit;
        font-size: 0.9em;
        height: 24px;
        padding: 0 var(--om-space-md);
        cursor: pointer;
        color: var(--vscode-button-foreground, #fff);
        background: var(--vscode-button-background, #0e639c);
        border: 1px solid var(--vscode-button-border, transparent);
        border-radius: var(--om-radius-sm);
      }
      button:disabled {
        opacity: var(--om-disabled-opacity);
        cursor: default;
      }
      .hint {
        color: var(--vscode-descriptionForeground);
        font-size: 0.85em;
      }
    `,
  ];

  @property({ type: Number }) cardIndex = 0;
  @property({ attribute: false }) results: ResultRef[] = [];
  /** Variable names per result id, supplied lazily by the host. */
  @property({ attribute: false }) variablesByResult: Record<string, string[]> = {};

  @state() private selResultId = "";
  /** Chosen segment name at each cascade level. */
  @state() private selections: string[] = [];

  private get tree(): VarNode[] {
    return buildVariableTree(this.variablesByResult[this.selResultId] ?? []);
  }

  private onResultChange(e: Event): void {
    this.selResultId = (e.target as HTMLSelectElement).value;
    this.selections = [];
    if (
      this.selResultId.length > 0 &&
      this.variablesByResult[this.selResultId] === undefined
    ) {
      fireEvent(this, "om-request-variables", { resultId: this.selResultId });
    }
  }

  private onLevelChange(level: number, e: Event): void {
    this.selections = withSelection(
      this.selections,
      level,
      (e.target as HTMLSelectElement).value,
    );
  }

  private onAdd(): void {
    const node = selectedNode(this.tree, this.selections);
    if (!this.selResultId || !node?.isLeaf) return;
    fireEvent(this, "om-add-trace", {
      cardIndex: this.cardIndex,
      resultId: this.selResultId,
      variable: node.path,
    });
    this.selections = [];
  }

  override render(): TemplateResult {
    if (this.results.length === 0) {
      return html`<span class="hint">Add a result to plot its variables.</span>`;
    }

    return html`
      <span class="ctrl">
        <select aria-label="Result" @change=${(e: Event) => this.onResultChange(e)}>
          <option value="" ?selected=${this.selResultId === ""}>Result…</option>
          ${this.results.map(
            (r) =>
              html`<option value=${r.id} ?selected=${this.selResultId === r.id}>
                ${r.label}
              </option>`,
          )}
        </select>
      </span>
      ${cascadeLevels(this.tree, this.selections).map(
        ({ level, opts, current }) => html`
          ${level > 0 ? html`<span class="sep">.</span>` : nothing}
          <select
            aria-label="Variable level ${level + 1}"
            @change=${(e: Event) => this.onLevelChange(level, e)}
          >
            <option value="" ?selected=${current === ""}>—</option>
            ${opts.map(
              (n) =>
                html`<option value=${n.name} ?selected=${current === n.name}>
                  ${n.name}${n.children.length > 0 ? " ›" : ""}
                </option>`,
            )}
          </select>
        `,
      )}
      <button
        ?disabled=${!selectedNode(this.tree, this.selections)?.isLeaf}
        @click=${() => this.onAdd()}
      >
        Add
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-add-trace-row": OmAddTraceRow;
  }
}
