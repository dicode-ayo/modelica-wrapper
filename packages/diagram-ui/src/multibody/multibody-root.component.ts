import { LitElement, css, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { consume, ContextProvider } from "@lit/context";
import { Container } from "pixi.js";

import { sceneContext, type SceneContext } from "../scene/scene-context.js";
import { parentNodeContext } from "../base/parent-node-context.js";

/**
 * `<om-multibody-root>` — placeholder element for the MultiBody view.
 * Creates a `Container` parented to the scene's `worldRoot` and provides
 * itself as the `parentNodeContext` for any descendant body elements.
 *
 * The 2D Pixi renderer cannot host true 3D geometry, so the MultiBody
 * body elements remain deferred; this keeps the seam and the context
 * provider in place.
 */
@customElement("om-multibody-root")
export class OmMultibodyRoot extends LitElement {
  static override styles = css`
    :host {
      display: contents;
    }
  `;

  @consume({ context: sceneContext, subscribe: true })
  private sceneCtx: SceneContext | null = null;

  private ownNode: Container | null = null;
  private readonly childContextProvider = new ContextProvider(this, {
    context: parentNodeContext,
    initialValue: null,
  });

  override render() {
    return nothing;
  }

  override updated(): void {
    if (!this.ownNode && this.sceneCtx) {
      const node = new Container({ label: "om-multibody-root" });
      this.sceneCtx.worldRoot.addChild(node);
      this.ownNode = node;
      this.childContextProvider.setValue(node);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.ownNode?.destroy({ children: true });
    this.ownNode = null;
    this.childContextProvider.setValue(null);
  }

  /** Live root container for tests. */
  get rootNode(): Container | null {
    return this.ownNode;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-multibody-root": OmMultibodyRoot;
  }
}
