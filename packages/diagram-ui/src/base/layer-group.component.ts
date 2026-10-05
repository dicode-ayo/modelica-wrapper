import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ContextProvider, consume } from "@lit/context";
import { Container } from "pixi.js";

import { parentNodeContext } from "./parent-node-context.js";
import { sceneContext, type SceneContext } from "../scene/scene-context.js";

/**
 * `<om-layer-group>` — a Pixi `Container` its slotted primitives attach to,
 * so they can be faded as one. Fully transparent hides the container
 * outright, so it costs nothing to draw.
 */
@customElement("om-layer-group")
export class OmLayerGroup extends LitElement {
  static override styles = css`
    :host {
      display: contents;
    }
  `;

  @property({ type: Number }) alpha = 1;

  @consume({ context: parentNodeContext, subscribe: true })
  private parentTransform: Container | null = null;

  @consume({ context: sceneContext, subscribe: true })
  private sceneCtx: SceneContext | null = null;

  private readonly provider = new ContextProvider(this, {
    context: parentNodeContext,
    initialValue: null,
  });

  private group = new Container({ label: "om-layer-group" });

  /** The container the slotted primitives attach to. */
  get container(): Container {
    return this.group;
  }

  override render(): TemplateResult {
    return html`<slot></slot>`;
  }

  override updated(): void {
    const parent = this.parentTransform;
    // The parent entity destroys its children with it on disconnect.
    if (this.group.destroyed) {
      this.group = new Container({ label: "om-layer-group" });
    }
    if (parent && this.group.parent !== parent) {
      this.group.sortableChildren = true;
      parent.addChild(this.group);
    }
    // Provided only once parented: primitives size their strokes from the
    // world scale of the container they attach to.
    this.provider.setValue(parent ? this.group : null);
    this.group.alpha = this.alpha;
    this.group.visible = this.alpha > 0;
    this.sceneCtx?.requestRender();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.group.removeFromParent();
    this.provider.setValue(null);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-layer-group": OmLayerGroup;
  }
}
