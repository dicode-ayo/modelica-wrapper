/**
 * `<om-overlay-stack>` — corner rail for the floating overlays that sit above
 * the diagram canvas.
 *
 * Children flow in a column pinned to one corner of the nearest positioned
 * ancestor, so a panel can sit under the toolbar without either knowing the
 * other's height. The rail keeps its inset on every edge, which is what bounds
 * a tall child: the last one shrinks and scrolls its own body rather than
 * running off the canvas.
 *
 * The rail itself is transparent to the pointer; only its children take
 * events, so the canvas underneath stays interactive between them.
 */

import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

import { omTokens } from "@dicode/ui-common";

export type OverlayAnchor =
  "top-right" | "top-left" | "bottom-right" | "bottom-left";

@customElement("om-overlay-stack")
export class OmOverlayStack extends LitElement {
  static override styles = [
    omTokens,
    css`
      :host {
        position: absolute;
        z-index: var(--om-z-overlay);
        display: flex;
        flex-direction: column;
        gap: var(--om-space-md);
        max-inline-size: calc(100% - 2 * var(--om-action-panel-offset));
        max-block-size: calc(100% - 2 * var(--om-action-panel-offset));
        pointer-events: none;
      }

      :host([anchor$="-right"]) {
        align-items: flex-end;
        inset-inline-end: var(--om-action-panel-offset);
      }
      :host([anchor$="-left"]) {
        align-items: flex-start;
        inset-inline-start: var(--om-action-panel-offset);
      }
      :host([anchor^="top-"]) {
        inset-block-start: var(--om-action-panel-offset);
      }
      :host([anchor^="bottom-"]) {
        inset-block-end: var(--om-action-panel-offset);
      }

      ::slotted(*) {
        pointer-events: auto;
      }
    `,
  ];

  /** Corner the rail pins to. */
  @property({ reflect: true })
  anchor: OverlayAnchor = "top-right";

  override render(): TemplateResult {
    return html`<slot></slot>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-overlay-stack": OmOverlayStack;
  }
}
