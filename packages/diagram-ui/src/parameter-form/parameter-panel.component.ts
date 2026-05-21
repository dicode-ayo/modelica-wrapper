/**
 * `<om-parameter-panel>` — side-drawer wrapper around `<om-parameter-form>`.
 *
 * Backed by `<wa-drawer placement="end">` so the diagram stays visible
 * while the user edits. Visible/hidden via the `open` boolean attribute
 * so the host can toggle it declaratively. Forwards the form's events
 * out as `om-panel-*` so the embedder doesn't need to know about the
 * form's internal API.
 *
 * Escape, backdrop click (`light-dismiss`), and the form's own
 * Cancel button all converge on `om-panel-cancel`. The form's optional
 * "Reset to defaults" button surfaces as `om-panel-reset`.
 */

import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

import "@awesome.me/webawesome/dist/components/drawer/drawer.js";

import type { ParameterModel } from "@modelica-wrapper/omc-client";

import "./parameter-form.component.js";
import type {
  ParameterFormChangeDetail,
  ParameterFormSubmitDetail,
} from "./parameter-form.component.js";

@customElement("om-parameter-panel")
export class OmParameterPanel extends LitElement {
  static override styles = css`
    :host {
      display: contents;
    }

    /* The drawer auto-shrinks on small screens; the form just needs a
     * sensible floor so its inputs don't squish. wa-drawer's width is
     * controlled via --size, passed inline below. */
    .form-host {
      display: block;
      min-width: 320px;
    }
  `;

  /** Whether the modal is shown. */
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
  @property({ attribute: "reset-label" }) resetLabel = "Reset to defaults";

  /** Forwarded straight to `<om-parameter-form>` — see its property docs. */
  @property({ attribute: "cref-prefix" })
  crefPrefix: string | undefined = undefined;

  override render(): TemplateResult {
    // Only render the wa-drawer when open: wa-button (which the drawer
    // uses internally for its close button) is form-associated and
    // crashes happy-dom on connectedCallback. Same pattern as
    // `<om-library-browser>`.
    if (!this.open) return html`${nothing}`;
    return html`
      <wa-drawer
        open
        placement="end"
        label=${this.title}
        light-dismiss
        style="--size: var(--om-panel-drawer-size)"
        @wa-hide=${this.onDrawerHide}
      >
        <om-parameter-form
          class="form-host"
          .model=${this.model}
          .crefPrefix=${this.crefPrefix}
          ?show-reset=${this.showReset}
          title=${this.title}
          submit-label=${this.submitLabel}
          cancel-label=${this.cancelLabel}
          reset-label=${this.resetLabel}
          @om-parameter-change=${this.onChange}
          @om-parameter-submit=${this.onSubmit}
          @om-parameter-cancel=${this.fireCancel}
          @om-parameter-reset=${this.onReset}
        ></om-parameter-form>
      </wa-drawer>
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

  private onReset(e: CustomEvent): void {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("om-panel-reset", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private onDrawerHide = (e: Event): void => {
    // Ignore wa-hide events that bubble up from nested wa-* components
    // (e.g. wa-select's listbox popover closing on option pick). Only
    // act when the drawer itself is requesting to close.
    if (e.target !== e.currentTarget) return;
    // wa-drawer's hide is cancellable; we never cancel — but we do stop
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
