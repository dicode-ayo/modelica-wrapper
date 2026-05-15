/**
 * `<om-action-panel>` — floating overlay with model-action buttons.
 *
 * Sits absolutely-positioned over whichever container it's nested in
 * (typically `<om-graphical-layout>`). Top-right by default; flippable
 * with the `anchor` attribute.
 *
 * Buttons today: Check, Simulate, Parameters. Each is a plain button —
 * keyboard accessible, focus-visible, themed against `--vscode-button-*`.
 *
 * Events:
 *   - `om-action-check`       — bubbles + composed, no detail
 *   - `om-action-simulate`    — bubbles + composed, no detail
 *   - `om-action-parameters`  — bubbles + composed, no detail
 *
 * Buttons can be hidden individually via boolean attributes
 * (`hide-check`, `hide-simulate`, `hide-parameters`) so embedders that
 * only want a subset don't have to fork.
 */

import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

import { omTokens } from "../base/om-tokens.js";

export type ActionPanelAnchor =
  | "top-right"
  | "top-left"
  | "bottom-right"
  | "bottom-left";

@customElement("om-action-panel")
export class OmActionPanel extends LitElement {
  static override styles = [
    omTokens,
    css`
      :host {
        position: absolute;
        z-index: var(--om-z-overlay);
        display: flex;
        gap: var(--om-space-sm);
        padding: var(--om-space-sm);
        background: var(
          --vscode-editorWidget-background,
          rgba(255, 255, 255, 0.92)
        );
        border: 1px solid
          var(--vscode-editorWidget-border, rgba(0, 0, 0, 0.15));
        border-radius: var(--om-radius-md);
        backdrop-filter: blur(var(--om-action-panel-blur));
        font-family: var(--vscode-font-family, system-ui, sans-serif);
        font-size: var(--vscode-font-size, 13px);
        color: var(--vscode-foreground, #1f1f1f);
      }

      :host([anchor="top-right"]) {
        top: var(--om-action-panel-offset);
        right: var(--om-action-panel-offset);
      }
      :host([anchor="top-left"]) {
        top: var(--om-action-panel-offset);
        left: var(--om-action-panel-offset);
      }
      :host([anchor="bottom-right"]) {
        bottom: var(--om-action-panel-offset);
        right: var(--om-action-panel-offset);
      }
      :host([anchor="bottom-left"]) {
        bottom: var(--om-action-panel-offset);
        left: var(--om-action-panel-offset);
      }

      button {
        font: inherit;
        padding: var(--om-button-padding);
        border: 1px solid var(--vscode-button-border, transparent);
        border-radius: var(--om-radius-sm);
        cursor: pointer;
        color: var(--vscode-button-foreground, #fff);
        background: var(--vscode-button-background, #0e639c);
      }

      button:hover {
        background: var(--vscode-button-hoverBackground, #1177bb);
      }

      button:focus-visible {
        outline: 1px solid var(--vscode-focusBorder, #007fd4);
        outline-offset: var(--om-space-2xs);
      }

      button[disabled] {
        opacity: var(--om-disabled-opacity);
        cursor: not-allowed;
      }
    `,
  ];

  /** Corner anchor for the floating panel. */
  @property({ reflect: true })
  anchor: ActionPanelAnchor = "top-right";

  /** When true, the buttons render disabled (e.g. before a model is loaded). */
  @property({ type: Boolean, reflect: true })
  disabled = false;

  @property({ type: Boolean, attribute: "hide-check" }) hideCheck = false;
  @property({ type: Boolean, attribute: "hide-simulate" }) hideSimulate = false;
  @property({ type: Boolean, attribute: "hide-parameters" })
  hideParameters = false;

  override render(): TemplateResult {
    return html`
      ${this.hideCheck
        ? nothing
        : html`<button
            ?disabled=${this.disabled}
            @click=${() => this.fire("om-action-check")}
            title="Check model (semantic check)"
          >Check</button>`}
      ${this.hideSimulate
        ? nothing
        : html`<button
            ?disabled=${this.disabled}
            @click=${() => this.fire("om-action-simulate")}
            title="Simulate model"
          >Simulate</button>`}
      ${this.hideParameters
        ? nothing
        : html`<button
            ?disabled=${this.disabled}
            @click=${() => this.fire("om-action-parameters")}
            title="Edit parameters"
          >Parameters</button>`}
    `;
  }

  private fire(type: string): void {
    this.dispatchEvent(
      new CustomEvent(type, { bubbles: true, composed: true }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-action-panel": OmActionPanel;
  }
}
