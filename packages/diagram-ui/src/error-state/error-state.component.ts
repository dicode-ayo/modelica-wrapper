/**
 * `<om-error-state>` — full-surface error card shown when an editor has
 * nothing to render (e.g. the initial layout fetch failed).
 *
 * Fills its container and centers a card carrying:
 *   - `heading` — what failed, in plain words.
 *   - `subject` — the affected class name, rendered as code.
 *   - `detail`  — the backend failure text.
 *   - `hint`    — what the user can do about it.
 *
 * `subject`, `detail`, and `hint` each render only when non-empty.
 */

import { LitElement, css, html, nothing, svg } from "lit";
import type { TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

import { omTokens } from "@dicode/ui-common";

import { glyph } from "../action-panel/toolbar-icons.js";

// Lucide (MIT) triangle-alert.
const warningIcon = glyph(
  svg`<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 20h16a2 2 0 0 0 1.73-2" />
    <path d="M12 9v4" /><path d="M12 17h.01" />`,
  "icon",
);

@customElement("om-error-state")
export class OmErrorState extends LitElement {
  static override styles = [
    omTokens,
    css`
      :host {
        display: grid;
        place-items: center;
        inline-size: 100%;
        block-size: 100%;
        font-family: var(--vscode-font-family, system-ui, sans-serif);
        font-size: var(--vscode-font-size, 13px);
        color: var(--vscode-foreground);
      }
      .card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--om-space-md);
        max-inline-size: var(--om-error-card-max-width);
        padding: var(--om-space-xl);
        text-align: center;
      }
      .icon {
        inline-size: var(--om-error-card-icon-size);
        block-size: var(--om-error-card-icon-size);
        color: var(--vscode-errorForeground, #f14c4c);
      }
      h2 {
        margin: 0;
        font-size: var(--om-title-size);
        font-weight: var(--om-title-weight);
      }
      code {
        font-family: var(--vscode-editor-font-family, monospace);
        background: var(--vscode-textCodeBlock-background, rgba(0, 0, 0, 0.1));
        border-radius: var(--om-radius-sm);
        padding: var(--om-space-2xs) var(--om-space-xs);
      }
      .detail {
        margin: 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: var(--om-description-size);
        color: var(--vscode-descriptionForeground);
      }
      .hint {
        margin: 0;
        color: var(--vscode-descriptionForeground);
      }
    `,
  ];

  @property() heading = "Something went wrong";
  @property() subject = "";
  @property() detail = "";
  @property() hint = "";

  override render(): TemplateResult {
    return html`
      <div class="card" role="alert">
        ${warningIcon}
        <h2>${this.heading}</h2>
        ${this.subject ? html`<code>${this.subject}</code>` : nothing}
        ${this.detail ? html`<p class="detail">${this.detail}</p>` : nothing}
        ${this.hint ? html`<p class="hint">${this.hint}</p>` : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-error-state": OmErrorState;
  }
}
