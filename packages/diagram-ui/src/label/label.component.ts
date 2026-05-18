import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { TransformNode } from "@babylonjs/core";
import { TextBlock } from "@babylonjs/gui";
import { expressionToString } from "@modelica-wrapper/diagram-svg";
import type { Expression } from "@modelica-wrapper/omc-client";

import { parentNodeContext } from "../base/parent-node-context.js";
import { requestSceneRender } from "../scene/render-scheduler.js";
import { ensureLabelTexture } from "./label-texture.js";

/**
 * `<om-label>` — places a text label in the scene linked to a Babylon
 * `TransformNode`. Renders via the shared `AdvancedDynamicTexture`
 * fullscreen UI, so font sizes are in screen pixels and stay readable
 * across the full zoom range.
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
  private parentTransform: TransformNode | null = null;

  private anchor: TransformNode | null = null;
  private textBlock: TextBlock | null = null;
  private pendingText = "";

  override render() {
    return html``;
  }

  override updated(): void {
    this.ensureAnchor();
    this.sync();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.textBlock) {
      this.textBlock.dispose();
      this.textBlock = null;
    }
    this.anchor?.dispose();
    this.anchor = null;
  }

  private ensureAnchor(): void {
    if (this.anchor || !this.parentTransform) {
      return;
    }
    const scene = this.parentTransform.getScene();
    this.anchor = new TransformNode(
      this.nodeId ? `om-label:${this.nodeId}` : "om-label",
      scene,
    );
    this.anchor.parent = this.parentTransform;

    const texture = ensureLabelTexture(scene);
    if (texture) {
      const block = new TextBlock();
      block.text = "";
      block.color = this.color;
      block.fontSize = this.fontSize;
      block.fontFamily = "sans-serif";
      block.resizeToFit = true;
      texture.addControl(block);
      block.linkWithMesh(this.anchor);
      this.textBlock = block;
    }
  }

  private sync(): void {
    if (!this.anchor) {
      return;
    }
    this.anchor.position.set(this.x, this.y, 0);
    this.pendingText = renderText(this.text);
    if (this.textBlock) {
      this.textBlock.text = this.pendingText;
      this.textBlock.fontSize = this.fontSize;
      this.textBlock.color = this.color;
      this.textBlock.rotation = (this.rotation * Math.PI) / 180;
    }
    requestSceneRender(this.anchor.getScene());
  }

  /** Returns the current text — useful for headless tests where the
   *  GUI texture is suppressed under `NullEngine`. */
  get currentText(): string {
    return this.textBlock?.text ?? this.pendingText;
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
