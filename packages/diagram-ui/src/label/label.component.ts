import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { Container, Point, Text, TextStyle } from "pixi.js";
import { expressionToString } from "@dicode/diagram-svg";
import type { Expression } from "@dicode/omc-client";

import { parentNodeContext } from "../base/parent-node-context.js";
import { sceneContext, type SceneContext } from "../scene/scene-context.js";
import {
  viewStateContext,
  type ViewStateStore,
} from "../scene/view-state-store.js";
import { tagEntity } from "../interaction/node-keys.js";
import { ensureLabelLayer } from "./label-texture.js";

const ANCHOR_ORIGIN = new Point(0, 0);

/**
 * `<om-label>` — places a text label in the scene linked to an in-world
 * anchor `Container`. The visible `Text` lives in a screen-space overlay
 * (see `ensureLabelLayer`) outside the pan/zoom/Y-flip transform, so font
 * sizes are in screen pixels and stay readable across the full zoom
 * range. Each frame the `Text` is reprojected to the anchor's global
 * (screen) position.
 *
 * Properties:
 *   - `x`, `y`            — diagram-coord position (parent local space)
 *   - `text`              — string OR Modelica `Expression` (auto-stringified)
 *   - `rotation`          — degrees, applied to the rendered text
 *   - `fontSize`          — screen px (default 12)
 *   - `color`             — `#rrggbb` text colour
 *
 * Labels can be:
 *   - direct children of `<om-scene>` (host class labels)
 *   - children of `<om-component>` / `<om-connector>` (entity labels;
 *     the (x, y) position is in the entity's local icon-coord system)
 */
@customElement("om-label")
export class OmLabel extends LitElement {
  static override styles = css`
    :host {
      display: none;
    }
  `;

  @property() nodeId = "";
  @property({ type: Number }) x = 0;
  @property({ type: Number }) y = 0;
  /** Accepts plain string or Modelica `Expression`. */
  @property({ attribute: false })
  text: string | Expression = "";
  @property({ type: Number }) rotation = 0;
  @property({ type: Number, attribute: "font-size" })
  fontSize = 12;
  @property() color: string = "#222";

  @consume({ context: parentNodeContext, subscribe: true })
  private parentContainer: Container | null = null;

  @consume({ context: sceneContext, subscribe: true })
  private sceneCtx: SceneContext | null = null;

  @consume({ context: viewStateContext, subscribe: true })
  private viewStore: ViewStateStore | null = null;

  private anchor: Container | null = null;
  private text2d: Text | null = null;
  private pendingText = "";
  private unsubscribe: (() => void) | null = null;

  override render() {
    return html``;
  }

  override updated(): void {
    this.ensureAnchor();
    this.ensureText();
    this.sync();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.text2d) {
      this.text2d.destroy();
      this.text2d = null;
    }
    if (this.anchor) {
      this.anchor.destroy();
      this.anchor = null;
    }
  }

  private ensureAnchor(): void {
    if (this.anchor || !this.parentContainer) {
      return;
    }
    const anchor = new Container();
    anchor.eventMode = "none";
    tagEntity(anchor, "label", this.nodeId);
    this.parentContainer.addChild(anchor);
    this.anchor = anchor;
  }

  /**
   * Create the overlay `Text` once the screen-space layer exists. Split
   * from `ensureAnchor` because the renderer (and thus the layer) only
   * arrives after the synchronous mount — this retries each update until
   * the layer is available. Renderer-less (headless tests) it stays a
   * no-op and `currentText` reports the pending string.
   */
  private ensureText(): void {
    if (this.text2d || !this.anchor) {
      return;
    }
    const ctx = this.sceneCtx;
    if (!ctx) {
      return;
    }
    const layer = ensureLabelLayer(ctx);
    if (!layer) {
      return;
    }
    const text = new Text({
      text: "",
      style: new TextStyle({
        fill: this.color,
        fontSize: this.fontSize,
        fontFamily: "sans-serif",
      }),
    });
    text.anchor.set(0.5);
    text.eventMode = "none";
    text.resolution = ctx.renderer?.resolution ?? 1;
    layer.addChild(text);
    this.text2d = text;

    if (this.viewStore && !this.unsubscribe) {
      this.unsubscribe = this.viewStore.subscribe(() => this.reproject());
    }
  }

  private sync(): void {
    const anchor = this.anchor;
    if (!anchor) {
      return;
    }
    anchor.position.set(this.x, this.y);
    this.pendingText = renderText(this.text);
    const text = this.text2d;
    if (text) {
      text.text = this.pendingText;
      text.style.fontSize = this.fontSize;
      text.style.fill = this.color;
      text.rotation = (this.rotation * Math.PI) / 180;
      this.reproject();
    }
    this.sceneCtx?.requestRender();
  }

  /**
   * Project the in-world anchor's origin to screen pixels and place the
   * overlay `Text` there. `toGlobal` refreshes the transform chain, so
   * this stays correct before the first render and after any pan/zoom.
   */
  private reproject(): void {
    const text = this.text2d;
    const anchor = this.anchor;
    if (!text || !anchor || anchor.destroyed) {
      return;
    }
    anchor.toGlobal(ANCHOR_ORIGIN, text.position);
  }

  /** Returns the current text — useful for headless tests where the
   *  overlay `Text` is suppressed without a renderer. */
  get currentText(): string {
    return this.text2d?.text ?? this.pendingText;
  }
}

function renderText(t: string | Expression): string {
  if (typeof t === "string") {
    return t;
  }
  return expressionToString(t as Expression);
}

declare global {
  interface HTMLElementTagNameMap {
    "om-label": OmLabel;
  }
}
