/**
 * `<om-split-button>` — a main action button flush against a chevron that opens
 * a variant menu. Presentational: it owns no state and emits what the user did.
 *
 * Properties:
 *   - `mainIcon` — glyph for the main button (a Lit `TemplateResult`).
 *   - `main-title` / `chevron-title` — tooltip + aria-label for each half.
 *   - `active` — draw the buttons filled (e.g. an armed tool).
 *   - `disabled` — disable both halves.
 *   - `items` — the chevron menu entries (`{ value, icon, label }`).
 *
 * Events (bubble + composed):
 *   - `om-split-main` — the main button was pressed (no detail).
 *   - `om-split-select` — `{ value }` of the chosen menu entry.
 */

import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/dropdown/dropdown.js";
import "@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js";

import { omTokens } from "@dicode/ui-common";

import { emitEvent } from "../dom-event.js";
import { toolbarButtonStyles } from "./toolbar-styles.js";
import { chevronDownIcon } from "./toolbar-icons.js";

export interface SplitButtonItem {
  value: string;
  icon: TemplateResult;
  label: string;
}

export interface SplitButtonSelectDetail {
  value: string;
}

export interface SplitButtonEvents {
  "om-split-main": undefined;
  "om-split-select": SplitButtonSelectDetail;
}

@customElement("om-split-button")
export class OmSplitButton extends LitElement {
  static override styles = [
    omTokens,
    toolbarButtonStyles,
    css`
      :host {
        display: inline-flex;
      }
      .split-main::part(base) {
        /* Flush against the chevron — the two halves read as one control. */
        border-start-end-radius: 0;
        border-end-end-radius: 0;
      }
      .split-chevron::part(base) {
        border-start-start-radius: 0;
        border-end-start-radius: 0;
        /* The chevron stays a narrow caret, not a square. */
        aspect-ratio: auto;
        padding-inline: var(--om-space-2xs);
      }
      .split-chevron .toolbar-icon {
        inline-size: var(--om-icon-size-sm);
        block-size: var(--om-icon-size-sm);
      }
      wa-dropdown-item .toolbar-icon {
        margin-inline-end: var(--om-space-xs);
        vertical-align: text-bottom;
      }
    `,
  ];

  @property({ attribute: false }) mainIcon: TemplateResult = html``;
  @property({ attribute: "main-title" }) mainTitle = "";
  @property({ attribute: "chevron-title" }) chevronTitle = "";
  @property({ type: Boolean }) active = false;
  @property({ type: Boolean }) disabled = false;
  @property({ attribute: false }) items: readonly SplitButtonItem[] = [];

  override render(): TemplateResult {
    const variant = this.active ? "brand" : "neutral";
    const appearance = this.active ? "filled" : "outlined";
    return html`
      <wa-button
        class="split-main"
        size="small"
        variant=${variant}
        appearance=${appearance}
        ?disabled=${this.disabled}
        title=${this.mainTitle}
        aria-label=${this.mainTitle}
        @click=${() => this.emit("om-split-main", undefined)}
        >${this.mainIcon}</wa-button
      >
      <wa-dropdown @wa-select=${this.onSelect}>
        <wa-button
          slot="trigger"
          class="split-chevron"
          size="small"
          variant=${variant}
          appearance=${appearance}
          ?disabled=${this.disabled}
          title=${this.chevronTitle}
          aria-label=${this.chevronTitle}
          >${chevronDownIcon}</wa-button
        >
        ${this.items.map(
          (it) =>
            html`<wa-dropdown-item value=${it.value}
              >${it.icon}${it.label}</wa-dropdown-item
            >`,
        )}
      </wa-dropdown>
    `;
  }

  private onSelect = (e: CustomEvent<{ item: Element }>): void => {
    const value = e.detail.item.getAttribute("value");
    if (value !== null) {
      this.emit("om-split-select", { value });
    }
  };

  private emit<K extends keyof SplitButtonEvents>(
    type: K,
    detail: SplitButtonEvents[K],
  ): void {
    emitEvent(this, type, detail);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-split-button": OmSplitButton;
  }
}
