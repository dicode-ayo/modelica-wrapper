/**
 * `<om-action-panel>` — floating overlay with the diagram toolbar.
 *
 * Sits absolutely-positioned over whichever container it's nested in
 * (typically `<om-graphical-layout>`). Top-right by default; flippable
 * with the `anchor` attribute.
 *
 * Buttons are icon-only (`title` carries the description + hotkey). Undo,
 * Check, Simulate, Parameters, Rotate, Flip, plus a draw-shape dropdown that
 * arms a drawing tool. Rotate / Flip act on the selection and disable via
 * `no-selection`; the draw dropdown reflects the host's `tool`.
 *
 * Events (bubble + composed):
 *   - `om-action-undo` / `-check` / `-simulate` / `-parameters` / `-rotate` /
 *     `-flip` — no detail.
 *   - `om-action-tool` — `{ tool }`, the tool the user wants armed (or
 *     `select` to disarm). The host owns the state and feeds it back via `tool`.
 *
 * Buttons hide individually via boolean attributes (`hide-undo`, …, `hide-flip`,
 * `hide-draw`).
 */

import {
  LitElement,
  css,
  html,
  nothing,
  type PropertyValues,
  type TemplateResult,
} from "lit";
import { customElement, property } from "lit/decorators.js";

import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/dropdown/dropdown.js";
import "@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js";

import { omTokens } from "@dicode/ui-common";

import {
  DRAW_KINDS,
  drawKindOf,
  type DrawKind,
  type ToolId,
} from "../interaction/tools.js";
import {
  caretIcon,
  checkIcon,
  drawKindIcon,
  flipIcon,
  parametersIcon,
  rotateIcon,
  simulateIcon,
  undoIcon,
} from "./toolbar-icons.js";

export type ActionPanelAnchor =
  | "top-right"
  | "top-left"
  | "bottom-right"
  | "bottom-left";

export type ActionUndoDetail = undefined;
export type ActionCheckDetail = undefined;
export type ActionSimulateDetail = undefined;
export type ActionParametersDetail = undefined;
export type ActionRotateDetail = undefined;
export type ActionFlipDetail = undefined;
export interface ActionToolDetail {
  tool: ToolId;
}

/**
 * Event-name → detail-type map for `<om-action-panel>`. Listener types
 * can come from here (`CustomEvent<ActionPanelEvents["om-action-tool"]>`).
 */
export interface ActionPanelEvents {
  "om-action-undo": ActionUndoDetail;
  "om-action-check": ActionCheckDetail;
  "om-action-simulate": ActionSimulateDetail;
  "om-action-parameters": ActionParametersDetail;
  "om-action-rotate": ActionRotateDetail;
  "om-action-flip": ActionFlipDetail;
  "om-action-tool": ActionToolDetail;
}

export type ActionPanelEventName = keyof ActionPanelEvents;

const DRAW_LABELS: Record<DrawKind, string> = {
  rectangle: "Rectangle",
  ellipse: "Ellipse",
};

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
        border: 1px solid var(--vscode-editorWidget-border, rgba(0, 0, 0, 0.15));
        border-radius: var(--om-radius-md);
        /* No backdrop-filter: see parameter-panel for the same reasoning —
         * blurring over a 60fps canvas pegs the GPU compositor. */
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

      .toolbar-icon {
        inline-size: var(--om-icon-size-md);
        block-size: var(--om-icon-size-md);
        display: block;
      }

      /* The draw trigger packs the shape glyph and the caret together. */
      .draw-trigger {
        display: inline-flex;
        align-items: center;
        gap: var(--om-space-2xs);
      }
      .draw-trigger .caret {
        inline-size: var(--om-icon-size-sm);
        block-size: var(--om-icon-size-sm);
      }

      wa-dropdown-item .toolbar-icon {
        margin-inline-end: var(--om-space-xs);
        vertical-align: text-bottom;
      }
    `,
  ];

  /** Corner anchor for the floating panel. */
  @property({ reflect: true })
  anchor: ActionPanelAnchor = "top-right";

  /** When true, the buttons render disabled (e.g. before a model is loaded). */
  @property({ type: Boolean, reflect: true })
  disabled = false;

  /** The armed drawing tool, owned by the host. The draw dropdown reflects it
   *  (which shape it shows, whether it reads as active). */
  @property()
  tool: ToolId = "select";

  @property({ type: Boolean, attribute: "hide-undo" }) hideUndo = false;
  @property({ type: Boolean, attribute: "hide-check" }) hideCheck = false;
  @property({ type: Boolean, attribute: "hide-simulate" }) hideSimulate = false;
  @property({ type: Boolean, attribute: "hide-parameters" })
  hideParameters = false;
  @property({ type: Boolean, attribute: "hide-rotate" }) hideRotate = false;
  @property({ type: Boolean, attribute: "hide-flip" }) hideFlip = false;
  @property({ type: Boolean, attribute: "hide-draw" }) hideDraw = false;

  /**
   * Rotate / flip act on the current diagram selection. When nothing is
   * selected they have no effect, so the embedder reflects that by
   * setting `no-selection`, which disables just those two buttons while
   * leaving the model-level actions (undo / check / …) live.
   */
  @property({ type: Boolean, attribute: "no-selection", reflect: true })
  noSelection = false;

  /** The shape the dropdown last armed — kept so the trigger keeps showing it
   *  after the tool is disarmed back to `select`. */
  private lastDrawKind: DrawKind = "rectangle";

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("tool")) {
      const armed = drawKindOf(this.tool);
      if (armed) {
        this.lastDrawKind = armed;
      }
    }
  }

  override render(): TemplateResult {
    const armed = drawKindOf(this.tool);
    return html`
      ${this.iconButton(
        this.hideUndo,
        "neutral",
        "outlined",
        undoIcon,
        "Undo last diagram edit (diagram-local)",
        () => this.fire("om-action-undo"),
      )}
      ${this.iconButton(
        this.hideCheck,
        "brand",
        "filled",
        checkIcon,
        "Check model (semantic check)",
        () => this.fire("om-action-check"),
      )}
      ${this.iconButton(
        this.hideSimulate,
        "brand",
        "filled",
        simulateIcon,
        "Simulate model",
        () => this.fire("om-action-simulate"),
      )}
      ${this.iconButton(
        this.hideParameters,
        "brand",
        "filled",
        parametersIcon,
        "Edit parameters",
        () => this.fire("om-action-parameters"),
      )}
      ${this.iconButton(
        this.hideRotate,
        "neutral",
        "outlined",
        rotateIcon,
        "Rotate selection 90° (R)",
        () => this.fire("om-action-rotate"),
        this.noSelection,
      )}
      ${this.iconButton(
        this.hideFlip,
        "neutral",
        "outlined",
        flipIcon,
        "Flip selection horizontally (F)",
        () => this.fire("om-action-flip"),
        this.noSelection,
      )}
      ${this.hideDraw ? nothing : this.drawDropdown(armed)}
    `;
  }

  private iconButton(
    hidden: boolean,
    variant: "brand" | "neutral",
    appearance: "filled" | "outlined",
    icon: TemplateResult,
    title: string,
    onClick: () => void,
    disabled = false,
  ): TemplateResult | typeof nothing {
    return hidden
      ? nothing
      : html`<wa-button
          size="small"
          variant=${variant}
          appearance=${appearance}
          ?disabled=${this.disabled || disabled}
          title=${title}
          aria-label=${title}
          @click=${onClick}
          >${icon}</wa-button
        >`;
  }

  private drawDropdown(armed: DrawKind | null): TemplateResult {
    // `lastDrawKind` is updated in `willUpdate`, keeping render pure.
    const shown = armed ?? this.lastDrawKind;
    return html`<wa-dropdown @wa-select=${this.onToolSelect}>
      <wa-button
        slot="trigger"
        size="small"
        variant=${armed ? "brand" : "neutral"}
        appearance=${armed ? "filled" : "outlined"}
        ?disabled=${this.disabled}
        title=${`Draw a ${DRAW_LABELS[shown].toLowerCase()} — pick a shape, then drag on the canvas`}
        aria-label="Draw shape"
      >
        <span class="draw-trigger"
          >${drawKindIcon(shown)}<span class="caret">${caretIcon}</span></span
        >
      </wa-button>
      ${DRAW_KINDS.map(
        (kind) =>
          html`<wa-dropdown-item value=${kind}
            >${drawKindIcon(kind)}${DRAW_LABELS[kind]}</wa-dropdown-item
          >`,
      )}
    </wa-dropdown>`;
  }

  private onToolSelect(e: CustomEvent<{ item: Element }>): void {
    const value = e.detail.item.getAttribute("value");
    const kind = DRAW_KINDS.find((k) => k === value);
    if (!kind) {
      return;
    }
    // Picking the armed shape again disarms it back to the select tool.
    const next: ToolId = kind === drawKindOf(this.tool) ? "select" : kind;
    this.dispatchEvent(
      new CustomEvent<ActionToolDetail>("om-action-tool", {
        detail: { tool: next },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private fire(type: ActionPanelEventName): void {
    this.dispatchEvent(
      new CustomEvent<ActionPanelEvents[typeof type]>(type, {
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-action-panel": OmActionPanel;
  }
}
