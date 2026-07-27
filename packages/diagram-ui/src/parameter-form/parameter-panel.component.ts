/**
 * `<om-parameter-panel>` — floating card wrapper around `<om-parameter-form>`.
 *
 * A non-modal overlay: there is no backdrop and the diagram underneath stays
 * fully interactive while the panel is up. Visible/hidden via the `open`
 * boolean attribute so the host can toggle it declaratively. Forwards the
 * form's events out as `om-panel-*` so the embedder doesn't need to know
 * about the form's internal API.
 *
 * Placement is the embedder's job — the host is a plain flow box that its
 * container positions (the webview stacks it under `<om-action-panel>`).
 *
 * Escape, the header's close button, and the form's own Cancel button all
 * converge on `om-panel-cancel`. The form's optional "Reset to defaults"
 * button surfaces as `om-panel-reset`.
 */

import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

import { omTokens } from "@dicode/ui-common";

import type { ParameterModel } from "@dicode/omc-client";

import "./parameter-form.component.js";
import type {
  ParameterFormChangeDetail,
  ParameterFormSubmitDetail,
} from "./parameter-form.component.js";

@customElement("om-parameter-panel")
export class OmParameterPanel extends LitElement {
  static override styles = [
    omTokens,
    css`
      :host {
        display: flex;
        flex-direction: column;
        inline-size: var(--om-panel-float-width);
        max-inline-size: 100%;
        max-block-size: var(--om-panel-float-max-height);
        box-sizing: border-box;
        /* Opaque, unlike the toolbar's translucent strip: the diagram showing
         * through a dense column of labels and inputs wrecks their contrast. */
        background: var(--vscode-editorWidget-background, #ffffff);
        border: 1px solid var(--vscode-editorWidget-border, rgba(0, 0, 0, 0.15));
        border-radius: var(--om-radius-md);
        box-shadow: var(--om-shadow-overlay);
        /* No backdrop-filter: blurring over a 60fps canvas pegs the GPU
         * compositor. */
        font-family: var(--vscode-font-family, system-ui, sans-serif);
        font-size: var(--vscode-font-size, 13px);
        color: var(--vscode-foreground, #1f1f1f);
      }

      :host(:not([open])) {
        display: none;
      }

      .card {
        display: flex;
        flex-direction: column;
        /* Without an explicit floor a flex item refuses to shrink below its
         * content, so the body would never scroll. */
        min-block-size: 0;
        outline: none;
      }

      .header {
        display: flex;
        align-items: center;
        gap: var(--om-space-md);
        padding: var(--om-space-md) var(--om-space-md) var(--om-space-md)
          var(--om-space-xl);
        border-bottom: 1px solid
          var(--vscode-editorWidget-border, rgba(0, 0, 0, 0.15));
      }

      .title {
        flex: 1;
        margin: 0;
        font-size: var(--om-title-size);
        font-weight: var(--om-title-weight);
        overflow-wrap: anywhere;
      }

      .close {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: var(--om-space-2xs);
        background: none;
        border: none;
        border-radius: var(--om-radius-sm);
        color: inherit;
        cursor: pointer;
      }

      .close:hover {
        background: var(--vscode-toolbar-hoverBackground, rgba(0, 0, 0, 0.08));
      }

      .close svg {
        inline-size: var(--om-icon-size-md);
        block-size: var(--om-icon-size-md);
        display: block;
      }

      .body {
        min-block-size: 0;
        overflow: auto;
      }
    `,
  ];

  /** Whether the panel is shown. */
  @property({ type: Boolean, reflect: true })
  open = false;

  /** Parameter model forwarded straight to `<om-parameter-form>`. */
  @property({ attribute: false })
  model: ParameterModel | undefined = undefined;

  @property() title = "";
  @property({ attribute: "submit-label" }) submitLabel = "Apply";
  @property({ attribute: "cancel-label" }) cancelLabel = "Cancel";

  /** Forwarded to `<om-parameter-form>` — gate the reset affordance. */
  @property({ type: Boolean, attribute: "show-reset" }) showReset = false;

  /** Read-only: forwarded to `<om-parameter-form>` to render fields inert. */
  @property({ type: Boolean, reflect: true }) readonly = false;
  @property({ attribute: "reset-label" }) resetLabel = "Reset to defaults";

  /** Forwarded straight to `<om-parameter-form>` — see its property docs. */
  @property({ attribute: "cref-prefix" })
  crefPrefix: string | undefined = undefined;

  override render(): TemplateResult {
    // Only render the contents when open: wa-button (which the form's
    // actions use) is form-associated and crashes happy-dom on
    // connectedCallback.
    if (!this.open) return html`${nothing}`;
    return html`
      <div
        class="card"
        role="dialog"
        aria-modal="false"
        aria-label=${this.title}
        tabindex="-1"
        @keydown=${this.onKeyDown}
      >
        <header class="header">
          <h2 class="title">${this.title}</h2>
          <button
            class="close"
            type="button"
            title="Close (Escape)"
            aria-label="Close"
            @click=${this.fireCancel}
          >
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </header>
        <div class="body">
          <om-parameter-form
            .model=${this.model}
            .crefPrefix=${this.crefPrefix}
            ?show-reset=${this.showReset}
            ?readonly=${this.readonly}
            submit-label=${this.submitLabel}
            cancel-label=${this.cancelLabel}
            reset-label=${this.resetLabel}
            @om-parameter-change=${this.onChange}
            @om-parameter-submit=${this.onSubmit}
            @om-parameter-cancel=${this.fireCancel}
            @om-parameter-reset=${this.onReset}
          ></om-parameter-form>
        </div>
      </div>
    `;
  }

  override updated(changed: Map<string, unknown>): void {
    // Escape only reaches the card while focus is inside it, so opening has
    // to move focus in.
    if (!changed.has("open") || !this.open) return;
    const card = this.renderRoot.querySelector<HTMLElement>(".card");
    card?.focus();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    this.fireCancel();
  };

  private onChange(e: CustomEvent<ParameterFormChangeDetail>): void {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<ParameterFormChangeDetail>("om-panel-change", {
        detail: e.detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private onSubmit(e: CustomEvent<ParameterFormSubmitDetail>): void {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<ParameterFormSubmitDetail>("om-panel-submit", {
        detail: e.detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private onReset(e: CustomEvent): void {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("om-panel-reset", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private fireCancel = (): void => {
    this.dispatchEvent(
      new CustomEvent("om-panel-cancel", {
        bubbles: true,
        composed: true,
      }),
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "om-parameter-panel": OmParameterPanel;
  }
}
