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
  DRAW_KINDS,
  drawKindOf,
  type DrawKind,
  type ToolId,
} from "../interaction/tools.js";
import "./split-button.component.js";
import type { SplitButtonSelectDetail } from "./split-button.component.js";
import { toolbarButtonStyles } from "./toolbar-styles.js";
import {
  checkIcon,
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

const DRAW_LABELS: Record<DrawKind, string> = {
  rectangle: "Rectangle",
  ellipse: "Ellipse",
};

const ROTATE_DIRECTIONS: readonly RotateDirection[] = ["cw", "ccw"];
const FLIP_AXES: readonly FlipAxis[] = ["horizontal", "vertical"];

function asDrawKind(value: string): DrawKind | undefined {
  return DRAW_KINDS.find((k) => k === value);
}

@customElement("om-action-panel")
export class OmActionPanel extends LitElement {
  static override styles = [
    omTokens,
    toolbarButtonStyles,
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
        () => this.emit("om-action-undo", undefined),
      )}
      ${this.iconButton(
        this.hideCheck,
        "brand",
        "filled",
        checkIcon,
        "Check model (semantic check)",
        () => this.emit("om-action-check", undefined),
      )}
      ${this.iconButton(
        this.hideSimulate,
        "brand",
        "filled",
        simulateIcon,
        "Simulate model",
        () => this.emit("om-action-simulate", undefined),
      )}
      ${this.iconButton(
        this.hideParameters,
        "brand",
        "filled",
        parametersIcon,
        "Edit parameters",
        () => this.emit("om-action-parameters", undefined),
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

  private rotateSplit(): TemplateResult {
    return html`<om-split-button
      .mainIcon=${rotateIcon}
      main-title="Rotate selection clockwise (R)"
      chevron-title="Rotate direction"
      ?disabled=${this.disabled || this.noSelection}
      .items=${[
        { value: "cw", icon: rotateIcon, label: "Clockwise (R)" },
        { value: "ccw", icon: rotateCcwIcon, label: "Counter-clockwise (⇧R)" },
      ]}
      @om-split-main=${() => this.emit("om-action-rotate", { direction: "cw" })}
      @om-split-select=${(e: CustomEvent<SplitButtonSelectDetail>) => {
        const direction = ROTATE_DIRECTIONS.find((d) => d === e.detail.value);
        if (direction) this.emit("om-action-rotate", { direction });
      }}
    ></om-split-button>`;
  }

  private flipSplit(): TemplateResult {
    return html`<om-split-button
      .mainIcon=${flipIcon}
      main-title="Flip selection horizontally (F)"
      chevron-title="Flip axis"
      ?disabled=${this.disabled || this.noSelection}
      .items=${[
        { value: "horizontal", icon: flipIcon, label: "Horizontal (F)" },
        { value: "vertical", icon: flipVerticalIcon, label: "Vertical (⇧F)" },
      ]}
      @om-split-main=${() =>
        this.emit("om-action-flip", { axis: "horizontal" })}
      @om-split-select=${(e: CustomEvent<SplitButtonSelectDetail>) => {
        const axis = FLIP_AXES.find((a) => a === e.detail.value);
        if (axis) this.emit("om-action-flip", { axis });
      }}
    ></om-split-button>`;
  }

  private drawSplit(): TemplateResult {
    const armed = drawKindOf(this.tool);
    const shown = armed ?? this.lastDrawKind;
    return html`<om-split-button
      .mainIcon=${drawKindIcon(shown)}
      main-title=${`Draw a ${DRAW_LABELS[shown].toLowerCase()} (drag on the canvas)`}
      chevron-title="Draw shape"
      ?active=${armed !== null}
      ?disabled=${this.disabled}
      .items=${[
        {
          value: "rectangle",
          icon: drawKindIcon("rectangle"),
          label: "Rectangle",
        },
        { value: "ellipse", icon: drawKindIcon("ellipse"), label: "Ellipse" },
      ]}
      @om-split-main=${() =>
        this.emit("om-action-tool", {
          tool: armed === shown ? "select" : shown,
        })}
      @om-split-select=${(e: CustomEvent<SplitButtonSelectDetail>) => {
        const kind = asDrawKind(e.detail.value);
        if (kind) this.emit("om-action-tool", { tool: kind });
      }}
    ></om-split-button>`;
  }

  private emit<K extends ActionPanelEventName>(
    type: K,
    detail: ActionPanelEvents[K],
  ): void {
    this.dispatchEvent(
      new CustomEvent(type, { detail, bubbles: true, composed: true }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-action-panel": OmActionPanel;
  }
}
