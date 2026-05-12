import { LitElement, css, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { consume, ContextProvider } from "@lit/context";
import { TransformNode } from "@babylonjs/core";

import { sceneContext, type SceneContext } from "../scene/scene-context.js";
import { parentNodeContext } from "../base/parent-node-context.js";

/**
 * `<om-multibody-root>` — placeholder element for the MultiBody 3D
 * layer. Creates a TransformNode parented to the scene's `worldRoot`
 * (NOT `diagramRoot`, so its content lives in true 3D space alongside
 * the diagram plane). Provides itself as the `parentNodeContext` for
 * any descendant body elements.
 *
 * The actual `<om-mb-box>` / `<om-mb-cylinder>` / `<om-mb-sphere>` /
 * file-mesh loader elements come in a follow-up. This commit is the
 * scaffolding so the seam exists alongside the camera-mode toggle.
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

  private ownNode: TransformNode | null = null;
  private readonly childContextProvider = new ContextProvider(this, {
    context: parentNodeContext,
    initialValue: null,
  });

  override render() {
    return nothing;
  }

  override updated(): void {
    if (!this.ownNode && this.sceneCtx) {
      this.ownNode = new TransformNode("om-multibody-root", this.sceneCtx.scene);
      this.ownNode.parent = this.sceneCtx.worldRoot;
      this.childContextProvider.setValue(this.ownNode);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.ownNode?.dispose(false, true);
    this.ownNode = null;
    this.childContextProvider.setValue(null);
  }

  /** Live root TransformNode for tests. */
  get rootNode(): TransformNode | null {
    return this.ownNode;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-multibody-root": OmMultibodyRoot;
  }
}
