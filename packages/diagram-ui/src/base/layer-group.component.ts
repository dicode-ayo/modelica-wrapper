import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ContextProvider, consume } from "@lit/context";
import { Container } from "pixi.js";

import { parentNodeContext } from "./parent-node-context.js";
import { sceneContext, type SceneContext } from "../scene/scene-context.js";

/** `<om-layer-group>` — a container its slotted primitives attach to, so they fade as one. */
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

  private group: Container | null = null;

  get container(): Container | null {
    return this.group;
  }

  override render(): TemplateResult {
    return html`<slot></slot>`;
  }

  override updated(): void {
    const parent = this.parentTransform;
    // Lit can flush after disconnect, when the parent has destroyed this group.
    if (!parent || !this.isConnected) return;
    const group = this.group ?? new Container({ label: "om-layer-group" });
    if (group.parent !== parent) {
      group.sortableChildren = true;
      parent.addChild(group);
    }
    this.group = group;
    // Provided once parented: primitives size strokes from its world scale.
    this.provider.setValue(group);
    group.alpha = this.alpha;
    group.visible = this.alpha > 0;
    this.sceneCtx?.requestRender();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.group?.removeFromParent();
    this.group = null;
    this.provider.setValue(null);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-layer-group": OmLayerGroup;
  }
}
