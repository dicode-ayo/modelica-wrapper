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
 * `subject`, `detail`, and `hint` each render only when non-empty. `detail`
 * collapses behind a toggle past `COLLAPSE_LINE_THRESHOLD` lines: a schema
 * mismatch listing otherwise pushes the hint out of view.
 */

import { LitElement, css, html, nothing, svg } from "lit";
import type { PropertyValues, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { omTokens } from "@dicode/ui-common";

import { glyph } from "../action-panel/toolbar-icons.js";

// Lucide (MIT) triangle-alert.
const warningIcon = glyph(
  svg`<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 20h16a2 2 0 0 0 1.73-2" />
    <path d="M12 9v4" /><path d="M12 17h.01" />`,
  "icon",
);

const COLLAPSE_LINE_THRESHOLD = 4;

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
        box-sizing: border-box;
        margin: 0;
        inline-size: 100%;
        max-block-size: var(--om-error-detail-max-height);
        overflow: auto;
        padding: var(--om-space-md);
        text-align: start;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: var(--om-description-size);
        color: var(--vscode-descriptionForeground);
        background: var(--vscode-textCodeBlock-background, rgba(0, 0, 0, 0.1));
        border-radius: var(--om-radius-md);
      }
      .actions {
        display: flex;
        gap: var(--om-space-md);
      }
      button {
        font: inherit;
        color: var(--vscode-textLink-foreground);
        background: none;
        border: none;
        padding: var(--om-space-2xs) var(--om-space-xs);
        cursor: pointer;
        text-decoration: underline;
      }
      button:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 1px;
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

  @state() private expanded = false;
  @state() private copyStatus: "idle" | "copied" | "failed" = "idle";

  private get collapsible(): boolean {
    return this.detail.split("\n").length > COLLAPSE_LINE_THRESHOLD;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("detail")) {
      this.expanded = false;
      this.copyStatus = "idle";
    }
  }

  private toggle(): void {
    this.expanded = !this.expanded;
  }

  private async copy(): Promise<void> {
    this.copyStatus = "idle";
    try {
      await navigator.clipboard.writeText(this.detail);
      this.copyStatus = "copied";
    } catch {
      this.copyStatus = "failed";
    }
  }

  private renderDetail(): TemplateResult | typeof nothing {
    if (!this.detail) return nothing;
    if (!this.collapsible) {
      return html`<p class="detail">${this.detail}</p>`;
    }
    const collapsed = !this.expanded;
    const copyLabel = {
      idle: "Copy details",
      copied: "Copied",
      failed: "Copy failed",
    }[this.copyStatus];
    return html`
      <div class="actions">
        <button
          type="button"
          class="toggle"
          aria-expanded=${this.expanded ? "true" : "false"}
          aria-controls="detail"
          @click=${this.toggle}
        >
          ${this.expanded ? "Hide details" : "Show details"}
        </button>
        <button type="button" class="copy" @click=${this.copy}>
          ${copyLabel}
        </button>
      </div>
      <pre class="detail" id="detail" ?hidden=${collapsed}>${this.detail}</pre>
    `;
  }

  override render(): TemplateResult {
    return html`
      <div class="card" role="alert">
        ${warningIcon}
        <h2>${this.heading}</h2>
        ${this.subject ? html`<code>${this.subject}</code>` : nothing}
        ${this.renderDetail()}
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
