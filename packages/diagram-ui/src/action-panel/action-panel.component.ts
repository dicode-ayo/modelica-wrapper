/**
 * `<om-action-panel>` — floating overlay with the diagram toolbar.
 *
 * Sits absolutely-positioned over whichever container it's nested in
 * (typically `<om-graphical-layout>`). Top-right by default; flippable
 * with the `anchor` attribute.
 *
 * Buttons are icon-only (`title` carries the description + hotkey). Undo,
 * Check, Simulate, Parameters are plain buttons; Rotate, Flip and Draw are
 * split buttons — the main half does the primary action (rotate cw / flip
 * horizontal / arm the current shape) and the chevron opens a menu to pick the
 * variant (cw·ccw / horizontal·vertical / rectangle·ellipse).
 *
 * Events (bubble + composed):
 *   - `om-action-undo` / `-check` / `-simulate` / `-parameters` — no detail.
 *   - `om-action-rotate` — `{ direction: "cw" | "ccw" }`.
 *   - `om-action-flip` — `{ axis: "horizontal" | "vertical" }`.
 *   - `om-action-tool` — `{ tool }`, the tool to arm (or `select` to disarm).
 *     The host owns tool state and feeds it back via `tool`.
 *
 * Buttons hide individually via boolean attributes (`hide-undo`, …, `hide-draw`).
 */

import {
  LitElement,
  css,
  html,
  nothing,
  type PropertyValues,
  type TemplateResult,
} from "lit";
import { customElement, property, state } from "lit/decorators.js";

import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/dropdown/dropdown.js";
import "@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js";

import { omTokens } from "@dicode/ui-common";

import {
  drawKindOf,
  type DrawKind,
  type ToolId,
} from "../interaction/tools.js";
import {
  checkIcon,
  chevronDownIcon,
  drawKindIcon,
  flipIcon,
  flipVerticalIcon,
  parametersIcon,
  rotateCcwIcon,
  rotateIcon,
  simulateIcon,
  undoIcon,
} from "./toolbar-icons.js";

export type ActionPanelAnchor =
  | "top-right"
  | "top-left"
  | "bottom-right"
  | "bottom-left";

export type RotateDirection = "cw" | "ccw";
export type FlipAxis = "horizontal" | "vertical";

export type ActionUndoDetail = undefined;
export type ActionCheckDetail = undefined;
export type ActionSimulateDetail = undefined;
export type ActionParametersDetail = undefined;
export interface ActionRotateDetail {
  direction: RotateDirection;
}
export interface ActionFlipDetail {
  axis: FlipAxis;
}
export interface ActionToolDetail {
  tool: ToolId;
}

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

interface MenuItem {
  value: string;
  icon: TemplateResult;
  label: string;
}

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

      wa-button::part(base) {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .toolbar-icon {
        inline-size: var(--om-icon-size-md);
        block-size: var(--om-icon-size-md);
        display: block;
      }

      /* Split button: main action + chevron, flush against each other. */
      .split {
        display: inline-flex;
      }
      .split-main::part(base) {
        border-start-end-radius: 0;
        border-end-end-radius: 0;
      }
      .split-chevron::part(base) {
        border-start-start-radius: 0;
        border-end-start-radius: 0;
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

  /** Corner anchor for the floating panel. */
  @property({ reflect: true })
  anchor: ActionPanelAnchor = "top-right";

  /** When true, the buttons render disabled (e.g. before a model is loaded). */
  @property({ type: Boolean, reflect: true })
  disabled = false;

  /** The armed drawing tool, owned by the host. The draw split reflects it. */
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
   * selected they have no effect, so the embedder sets `no-selection` to
   * disable just those, leaving the model-level actions live.
   */
  @property({ type: Boolean, attribute: "no-selection", reflect: true })
  noSelection = false;

  /** Last shape the draw split armed — kept so its main half keeps showing it
   *  after a draw auto-disarms back to `select`. */
  @state() private lastDrawKind: DrawKind = "rectangle";

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("tool")) {
      const armed = drawKindOf(this.tool);
      if (armed) {
        this.lastDrawKind = armed;
      }
    }
  }

  override render(): TemplateResult {
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
      ${this.hideRotate ? nothing : this.rotateSplit()}
      ${this.hideFlip ? nothing : this.flipSplit()}
      ${this.hideDraw ? nothing : this.drawSplit()}
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

  /** A main action button + a chevron that opens a variant menu. */
  private splitButton(opts: {
    mainIcon: TemplateResult;
    mainTitle: string;
    chevronTitle: string;
    active: boolean;
    disabled: boolean;
    onMain: () => void;
    items: readonly MenuItem[];
    onSelect: (value: string) => void;
  }): TemplateResult {
    const variant = opts.active ? "brand" : "neutral";
    const appearance = opts.active ? "filled" : "outlined";
    const off = this.disabled || opts.disabled;
    return html`<span class="split">
      <wa-button
        class="split-main"
        size="small"
        variant=${variant}
        appearance=${appearance}
        ?disabled=${off}
        title=${opts.mainTitle}
        aria-label=${opts.mainTitle}
        @click=${opts.onMain}
        >${opts.mainIcon}</wa-button
      >
      <wa-dropdown
        @wa-select=${(e: CustomEvent<{ item: Element }>) => {
          const value = e.detail.item.getAttribute("value");
          if (value !== null) opts.onSelect(value);
        }}
      >
        <wa-button
          slot="trigger"
          class="split-chevron"
          size="small"
          variant=${variant}
          appearance=${appearance}
          ?disabled=${off}
          title=${opts.chevronTitle}
          aria-label=${opts.chevronTitle}
          >${chevronDownIcon}</wa-button
        >
        ${opts.items.map(
          (it) =>
            html`<wa-dropdown-item value=${it.value}
              >${it.icon}${it.label}</wa-dropdown-item
            >`,
        )}
      </wa-dropdown>
    </span>`;
  }

  private rotateSplit(): TemplateResult {
    return this.splitButton({
      mainIcon: rotateIcon,
      mainTitle: "Rotate selection clockwise (R)",
      chevronTitle: "Rotate direction",
      active: false,
      disabled: this.noSelection,
      onMain: () => this.fireRotate("cw"),
      items: [
        { value: "cw", icon: rotateIcon, label: "Clockwise (R)" },
        { value: "ccw", icon: rotateCcwIcon, label: "Counter-clockwise (⇧R)" },
      ],
      onSelect: (v) => this.fireRotate(v === "ccw" ? "ccw" : "cw"),
    });
  }

  private flipSplit(): TemplateResult {
    return this.splitButton({
      mainIcon: flipIcon,
      mainTitle: "Flip selection horizontally (F)",
      chevronTitle: "Flip axis",
      active: false,
      disabled: this.noSelection,
      onMain: () => this.fireFlip("horizontal"),
      items: [
        { value: "horizontal", icon: flipIcon, label: "Horizontal (F)" },
        { value: "vertical", icon: flipVerticalIcon, label: "Vertical (⇧F)" },
      ],
      onSelect: (v) =>
        this.fireFlip(v === "vertical" ? "vertical" : "horizontal"),
    });
  }

  private drawSplit(): TemplateResult {
    const armed = drawKindOf(this.tool);
    const shown = armed ?? this.lastDrawKind;
    return this.splitButton({
      mainIcon: drawKindIcon(shown),
      mainTitle: `Draw a ${DRAW_LABELS[shown].toLowerCase()} (drag on the canvas)`,
      chevronTitle: "Draw shape",
      active: armed !== null,
      disabled: false,
      // Toggle: arm the shown shape, or disarm if it's already armed.
      onMain: () => this.fireTool(armed === shown ? "select" : shown),
      items: [
        {
          value: "rectangle",
          icon: drawKindIcon("rectangle"),
          label: "Rectangle",
        },
        { value: "ellipse", icon: drawKindIcon("ellipse"), label: "Ellipse" },
      ],
      onSelect: (v) => this.fireTool(v === "ellipse" ? "ellipse" : "rectangle"),
    });
  }

  private fireRotate(direction: RotateDirection): void {
    this.dispatchEvent(
      new CustomEvent<ActionRotateDetail>("om-action-rotate", {
        detail: { direction },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private fireFlip(axis: FlipAxis): void {
    this.dispatchEvent(
      new CustomEvent<ActionFlipDetail>("om-action-flip", {
        detail: { axis },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private fireTool(tool: ToolId): void {
    this.dispatchEvent(
      new CustomEvent<ActionToolDetail>("om-action-tool", {
        detail: { tool },
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
