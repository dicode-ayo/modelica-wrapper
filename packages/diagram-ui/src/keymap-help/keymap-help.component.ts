/**
 * `<om-keymap-help>` — dialog listing every diagram command that has a bound
 * keyboard shortcut, grouped by category. The host builds `groups` (via
 * `commandsToKeymapHelpGroups`, reading the same `CommandRegistry` and keymap
 * the context menu and action panel consume) and sets it here, so this view
 * can never drift from what's actually bound.
 *
 * Backed by `<wa-dialog>` for focus trapping, Escape-to-close, and
 * light-dismiss.
 *
 * Events (bubble + composed):
 *   - `om-keymap-help-close` (undefined)
 */

import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

import "@awesome.me/webawesome/dist/components/dialog/dialog.js";

import { omTokens } from "@dicode/ui-common";

import { emitEvent } from "../dom-event.js";

export interface KeymapHelpItem {
  id: string;
  title: string;
  /** Display-formatted chords bound to this command, e.g. `"Shift+R"`. */
  chords: readonly string[];
  /** Whether the command is runnable in the diagram's current context. */
  enabled: boolean;
}

export interface KeymapHelpGroup {
  category: string;
  items: readonly KeymapHelpItem[];
}

export type KeymapHelpCloseDetail = undefined;

export interface KeymapHelpEvents {
  "om-keymap-help-close": KeymapHelpCloseDetail;
}

@customElement("om-keymap-help")
export class OmKeymapHelp extends LitElement {
  static override styles = [
    omTokens,
    css`
      :host {
        display: contents;
      }

      section + section {
        margin-top: var(--om-space-lg);
      }

      h3 {
        margin: 0 0 var(--om-space-xs);
        font-size: 0.85em;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--vscode-descriptionForeground, #767676);
      }

      dl {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: var(--om-space-xs);
      }

      .row {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: var(--om-space-lg);
      }

      .row[data-disabled] {
        opacity: 0.5;
      }

      dt {
        font-weight: normal;
      }

      dd {
        margin: 0;
        display: flex;
        gap: var(--om-space-xs);
        justify-content: flex-end;
      }

      kbd {
        padding: 0 var(--om-space-xs);
        border: 1px solid
          var(--vscode-keybindingLabel-border, rgba(128, 128, 128, 0.4));
        border-radius: var(--om-radius-sm);
        background: var(
          --vscode-keybindingLabel-background,
          rgba(128, 128, 128, 0.17)
        );
        color: var(--vscode-keybindingLabel-foreground, inherit);
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 0.9em;
      }

      .empty {
        margin: 0;
        color: var(--vscode-descriptionForeground, #767676);
      }
    `,
  ];

  /** Whether the dialog is shown. */
  @property({ type: Boolean, reflect: true })
  open = false;

  /** Commands grouped by category, already filtered to those with a binding. */
  @property({ attribute: false })
  groups: readonly KeymapHelpGroup[] = [];

  override render(): TemplateResult {
    if (!this.open) return html`${nothing}`;
    return html`
      <wa-dialog
        open
        label="Keyboard shortcuts"
        light-dismiss
        @wa-hide=${this.onDialogHide}
      >
        ${this.groups.length === 0
          ? html`<p class="empty">No keyboard shortcuts are available.</p>`
          : this.groups.map(
              (group) => html`
                <section>
                  <h3>${group.category}</h3>
                  <dl>
                    ${group.items.map(
                      (item) => html`
                        <div class="row" ?data-disabled=${!item.enabled}>
                          <dt>${item.title}</dt>
                          <dd>
                            ${item.chords.map(
                              (chord) => html`<kbd>${chord}</kbd>`,
                            )}
                          </dd>
                        </div>
                      `,
                    )}
                  </dl>
                </section>
              `,
            )}
      </wa-dialog>
    `;
  }

  private readonly onDialogHide = (e: Event): void => {
    // Ignore wa-hide events bubbling up from nested wa-* components; only
    // act when the dialog itself is requesting to close.
    if (e.target !== e.currentTarget) return;
    e.stopPropagation();
    if (this.open) {
      this.open = false;
      this.emit("om-keymap-help-close", undefined);
    }
  };

  private emit<K extends keyof KeymapHelpEvents>(
    type: K,
    detail: KeymapHelpEvents[K],
  ): void {
    emitEvent(this, type, detail);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-keymap-help": OmKeymapHelp;
  }
}
