/**
 * `<om-parameter-panel>` — modal wrapper around `<om-parameter-form>`.
 *
 * Renders a centered card with a backdrop. Visible/hidden via the `open`
 * boolean attribute so the host can toggle it declaratively. Forwards
 * the form's events out as `om-panel-*` so the embedder doesn't need to
 * know about the form's internal API.
 *
 * The backdrop click and Escape key both fire `om-panel-cancel`. The
 * card itself stops click propagation so clicks inside don't dismiss.
 */

import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

import type { JsonSchema } from "@modelica-wrapper/omc-client";

import { omTokens } from "../base/om-tokens.js";

import "./parameter-form.component.js";
import type {
  ParameterFormChangeDetail,
  ParameterFormSubmitDetail,
} from "./parameter-form.component.js";

type Schema = JsonSchema;

@customElement("om-parameter-panel")
export class OmParameterPanel extends LitElement {
  static override styles = [
    omTokens,
    css`
      :host {
        position: fixed;
        inset: 0;
        z-index: var(--om-z-modal);
        display: none;
        align-items: flex-start;
        justify-content: center;
        padding-top: var(--om-modal-offset-top);
        background: var(--om-modal-backdrop);
        /*
         * No backdrop-filter: blur on purpose. The Babylon canvas behind
         * this modal redraws on every render loop tick, which forces the
         * compositor to re-blur on every paint. Combined with the modal's
         * own internal scroll, that pegged the GPU on real hardware. A
         * solid darker backdrop reads as "focused" without the cost.
         */
      }

      :host([open]) {
        display: flex;
      }

      .card {
        min-width: var(--om-modal-min-width);
        max-width: min(var(--om-modal-max-width), var(--om-modal-max-vw));
        max-height: var(--om-modal-max-height);
        overflow-y: auto;
        border-radius: var(--om-radius-lg);
        box-shadow: var(--om-modal-shadow);
        background: var(--vscode-editorWidget-background, #f3f3f3);
        color: var(--vscode-foreground, #1f1f1f);
      }
    `,
  ];

  /** Whether the modal is shown. */
  @property({ type: Boolean, reflect: true })
  open = false;

  /** Schema + values + labels forwarded straight to `<om-parameter-form>`. */
  @property({ attribute: false })
  schema: Schema | undefined = undefined;

  @property({ attribute: false })
  values: Record<string, unknown> = {};

  @property() title = "";
  @property({ attribute: "submit-label" }) submitLabel = "Apply";
  @property({ attribute: "cancel-label" }) cancelLabel = "Cancel";

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && this.open) {
      this.fireCancel();
    }
  };

  override connectedCallback(): void {
    super.connectedCallback();
    // Listen on the window so Escape works even when focus is outside
    // the modal (e.g. the user just dismissed an enum dropdown).
    window.addEventListener("keydown", this.onKeyDown);
  }

  override disconnectedCallback(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    super.disconnectedCallback();
  }

  override render(): TemplateResult {
    if (!this.open) return html`${nothing}`;
    return html`
      <div class="card" @click=${(e: Event) => e.stopPropagation()}>
        <om-parameter-form
          .schema=${this.schema}
          .values=${this.values}
          title=${this.title}
          submit-label=${this.submitLabel}
          cancel-label=${this.cancelLabel}
          @om-parameter-change=${this.onChange}
          @om-parameter-submit=${this.onSubmit}
          @om-parameter-cancel=${this.fireCancel}
        ></om-parameter-form>
      </div>
    `;
  }

  /** Backdrop click handler — wired on the host itself. */
  override firstUpdated(): void {
    this.addEventListener("click", () => this.fireCancel());
  }

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
