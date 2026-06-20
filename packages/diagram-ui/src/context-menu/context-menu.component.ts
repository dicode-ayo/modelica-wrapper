/**
 * `<om-context-menu>` — a presentational popup menu positioned at a cursor
 * point. Dumb on purpose: it takes a flat `items` list (already ordered, with
 * a `group` per item for separators), shows itself via `open(x, y)`, and emits
 * `om-context-menu-select` with the chosen item's id. The host decides what the
 * items are and what selecting one does — here, `<om-graphical-layout>` feeds it
 * from the command registry and runs the picked command.
 *
 * The menu is `position: fixed` at the cursor `(x, y)`. Viewport-edge flipping
 * is a follow-up; today it renders at the given point.
 *
 * Events (bubble + composed):
 *   - `om-context-menu-select` { id: string }
 *   - `om-context-menu-close`  (undefined)
 */

import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";

import { omTokens } from "@dicode/ui-common";

export interface ContextMenuItem {
  id: string;
  label: string;
  disabled?: boolean | undefined;
  /** Items sharing a `group` render together; a separator falls between groups. */
  group?: string | undefined;
}

export type ContextMenuSelectDetail = { id: string };
export type ContextMenuCloseDetail = undefined;

export interface ContextMenuEvents {
  "om-context-menu-select": ContextMenuSelectDetail;
  "om-context-menu-close": ContextMenuCloseDetail;
}

@customElement("om-context-menu")
export class OmContextMenu extends LitElement {
  static override styles = [
    omTokens,
    css`
      [role="menu"] {
        position: fixed;
        z-index: var(--om-z-overlay);
        min-width: 12ch;
        padding: var(--om-space-xs) 0;
        background: var(
          --vscode-menu-background,
          var(--vscode-editorWidget-background, #fff)
        );
        border: 1px solid
          var(--vscode-menu-border, var(--vscode-editorWidget-border, #ccc));
        border-radius: var(--om-radius-md);
        box-shadow: var(--om-shadow-overlay);
        font-family: var(--vscode-font-family, system-ui, sans-serif);
        font-size: var(--vscode-font-size, 13px);
        color: var(--vscode-menu-foreground, var(--vscode-foreground, #1f1f1f));
      }

      button {
        display: block;
        inline-size: 100%;
        text-align: start;
        padding: var(--om-space-xs) var(--om-space-lg);
        background: none;
        border: none;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      button:hover:not(:disabled),
      button:focus-visible {
        background: var(--vscode-menu-selectionBackground, #0a64c2);
        color: var(--vscode-menu-selectionForeground, #fff);
        outline: none;
      }
      button:disabled {
        opacity: 0.5;
        cursor: default;
      }

      hr {
        margin: var(--om-space-xs) 0;
        border: none;
        border-top: 1px solid
          var(--vscode-menu-separatorBackground, rgba(0, 0, 0, 0.15));
      }
    `,
  ];

  /** Items to render, in display order. */
  @property({ attribute: false })
  items: readonly ContextMenuItem[] = [];

  @state() private opened = false;
  @state() private x = 0;
  @state() private y = 0;

  private setPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  /** Show the menu with its top-left at the given client coordinates. */
  open(x: number, y: number): void {
    this.setPosition(x, y);
    this.opened = true;
    void this.updateComplete.then(() => this.focusFirst());
  }

  /** Reposition an already-open menu (e.g. to track a point through pan/zoom). */
  moveTo(x: number, y: number): void {
    if (this.opened) {
      this.setPosition(x, y);
    }
  }

  close(): void {
    if (!this.opened) {
      return;
    }
    this.opened = false;
    this.emit("om-context-menu-close", undefined);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Capture so an outside press dismisses before it lands elsewhere.
    document.addEventListener("pointerdown", this.onDocumentPointerDown, true);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener(
      "pointerdown",
      this.onDocumentPointerDown,
      true,
    );
  }

  private readonly onDocumentPointerDown = (e: PointerEvent): void => {
    if (!this.opened) {
      return;
    }
    if (!e.composedPath().includes(this)) {
      this.close();
    }
  };

  private readonly onMenuKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      this.close();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      this.moveFocus(e.key === "ArrowDown" ? 1 : -1);
    }
  };

  private readonly onMenuClick = (e: MouseEvent): void => {
    const target = e.target;
    const button = target instanceof Element ? target.closest("button") : null;
    if (!button || button.disabled) {
      return;
    }
    const id = button.dataset.id;
    if (id === undefined) {
      return;
    }
    this.opened = false;
    this.emit("om-context-menu-select", { id });
  };

  private readonly onMenuContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private buttons(): HTMLButtonElement[] {
    return [
      ...this.renderRoot.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ),
    ];
  }

  private focusFirst(): void {
    this.buttons()[0]?.focus();
  }

  private moveFocus(delta: number): void {
    const items = this.buttons();
    if (items.length === 0) {
      return;
    }
    const active = this.shadowRoot?.activeElement ?? null;
    const current = items.findIndex((b) => b === active);
    const next = (current + delta + items.length) % items.length;
    items[next]?.focus();
  }

  override render(): TemplateResult | typeof nothing {
    if (!this.opened || this.items.length === 0) {
      return nothing;
    }
    // Build rows as flat siblings — a separator and a button must each be their
    // own template (a template that *starts* with `${expr}<button attr=${…}>`
    // mis-aligns Lit's attribute bindings).
    const rows: TemplateResult[] = [];
    this.items.forEach((item, i) => {
      const prev = this.items[i - 1];
      if (prev && (prev.group ?? "") !== (item.group ?? "")) {
        rows.push(html`<hr role="separator" />`);
      }
      rows.push(
        html`<button
          role="menuitem"
          data-id=${item.id}
          ?disabled=${item.disabled}
        >
          ${item.label}
        </button>`,
      );
    });
    return html`<div
      role="menu"
      style=${styleMap({ left: `${this.x}px`, top: `${this.y}px` })}
      @click=${this.onMenuClick}
      @keydown=${this.onMenuKeyDown}
      @contextmenu=${this.onMenuContextMenu}
    >
      ${rows}
    </div>`;
  }

  private emit<K extends keyof ContextMenuEvents>(
    type: K,
    detail: ContextMenuEvents[K],
  ): void {
    this.dispatchEvent(
      new CustomEvent<ContextMenuEvents[K]>(type, {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-context-menu": OmContextMenu;
  }
}
