/**
 * `<om-icon-button>` — the borderless dismiss/affordance button shared by the
 * postprocessing components (the plot/trace/result ✕ controls). Pure presentation:
 * it renders a `<button>` around its slotted glyph and lets the native `click`
 * bubble (composed) to the parent, which owns the actual handler. Positioning
 * (e.g. absolute placement of a chip's remove button) stays on the parent via a
 * class on the host.
 */

import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

import { omTokens } from "@modelica-wrapper/ui-common";

@customElement("om-icon-button")
export class OmIconButton extends LitElement {
  static override styles = [
    omTokens,
    css`
      :host {
        display: inline-flex;
      }
      button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font: inherit;
        line-height: 1.4;
        border: none;
        background: transparent;
        cursor: pointer;
        color: var(--vscode-descriptionForeground);
        border-radius: var(--om-radius-sm);
        padding: 0 var(--om-space-xs);
      }
      button:hover {
        color: var(--vscode-errorForeground);
        background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.2));
      }
    `,
  ];

  /** Accessible name + native tooltip for the button. */
  @property() label = "";

  override render(): TemplateResult {
    return html`<button title=${this.label} aria-label=${this.label}>
      <slot></slot>
    </button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-icon-button": OmIconButton;
  }
}
