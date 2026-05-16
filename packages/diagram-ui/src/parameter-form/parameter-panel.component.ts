/**
 * `<om-parameter-panel>` — modal wrapper around `<om-parameter-form>`.
 *
 * Backed by `<wa-dialog>`. Visible/hidden via the `open` boolean
 * attribute so the host can toggle it declaratively. Forwards the
 * form's events out as `om-panel-*` so the embedder doesn't need to
 * know about the form's internal API.
 *
 * Escape, backdrop click (`light-dismiss`), and the form's own
 * Cancel button all converge on `om-panel-cancel`.
 */

import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

import "@awesome.me/webawesome/dist/components/dialog/dialog.js";

import type { JsonSchema } from "@modelica-wrapper/omc-client";

import "./parameter-form.component.js";
import type {
  ParameterFormChangeDetail,
  ParameterFormSubmitDetail,
} from "./parameter-form.component.js";

type Schema = JsonSchema;

@customElement("om-parameter-panel")
export class OmParameterPanel extends LitElement {
  static override styles = css`
    :host {
      display: contents;
    }

    /* Give the parameter form a comfortable width that still respects
     * the dialog's responsive shrink. wa-dialog exposes --width as a
     * custom property; we pass it inline on the wa-dialog element. */
    .form-host {
      display: block;
      min-width: 320px;
    }
  `;

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

  override render(): TemplateResult {
    // Only render the wa-dialog when open: wa-button (which the dialog
    // uses internally for its close button) is form-associated and
    // crashes happy-dom on connectedCallback. Same pattern as
    // `<om-library-browser>`.
    if (!this.open) return html`${nothing}`;
    return html`
      <wa-dialog
        open
        label=${this.title}
        light-dismiss
        style="--width: var(--om-modal-max-width, 540px)"
        @wa-hide=${this.onDialogHide}
      >
        <om-parameter-form
          class="form-host"
          .schema=${this.schema}
          .values=${this.values}
          title=${this.title}
          submit-label=${this.submitLabel}
          cancel-label=${this.cancelLabel}
          @om-parameter-change=${this.onChange}
          @om-parameter-submit=${this.onSubmit}
          @om-parameter-cancel=${this.fireCancel}
        ></om-parameter-form>
      </wa-dialog>
    `;
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

  private onDialogHide = (e: Event): void => {
    // wa-dialog's hide is cancellable; we never cancel — but we do stop
    // propagation so the event doesn't escape and confuse other
    // listeners on the page.
    e.stopPropagation();
    if (this.open) {
      this.open = false;
      this.fireCancel();
    }
  };

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
