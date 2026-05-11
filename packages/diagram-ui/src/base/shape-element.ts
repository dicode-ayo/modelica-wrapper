import { LitElement, css, html } from "lit";
import { property } from "lit/decorators.js";
import { ContextProvider, consume } from "@lit/context";
import type {
  CoordinateSystem,
  IconLayer,
  Placement,
} from "@modelica-wrapper/omc-client";

import { parentNodeContext } from "./parent-node-context.js";
import {
  iconProviderContext,
  type IconProviderContext,
} from "../icon-provider/icon-provider-context.js";
import { OmShapeNode } from "./shape-node.js";

/**
 * Base class for `<om-component>`, `<om-connector>`, and other shape-
 * carrying entities. Bridges the Lit lifecycle to a Babylon `OmShapeNode`:
 *
 *  - Consumes the parent `TransformNode` from the Lit context.
 *  - Consumes the `IconProvider` context to obtain a texture from the
 *    component's `IconLayer[]`.
 *  - Provides its own `TransformNode` as the parent context for children
 *    (nested connectors, labels) — children attach in the entity's
 *    local icon coordinate system.
 *
 * Subclasses only need to:
 *   - Pick a `nodeName` for debugging
 *   - Optionally override `onShapeNodeReady(node)` to add extra meshes
 *     (e.g. the port-indicator dot on `<om-connector>`)
 */
export abstract class OmShapeElement extends LitElement {
  static override styles = css`
    :host {
      display: contents;
    }
  `;

  /** Modelica placement of this entity in its parent's coord system. */
  @property({ attribute: false })
  placement: Placement = { extent: [[-10, -10], [10, 10]] };

  /** Icon shape layers (ancestor-first / host-last). */
  @property({ attribute: false })
  layers: IconLayer[] = [];

  /** Coordinate system declared by the icon's host class. */
  @property({ attribute: false })
  coordinateSystem: CoordinateSystem | undefined = undefined;

  /** Selection state — purely a flag for now (E2 wires visuals). */
  @property({ type: Boolean, reflect: true })
  selected = false;

  /** Read-only flag forwarded to the interaction manager in stage E. */
  @property({ type: Boolean, reflect: true })
  readonly = false;

  @consume({ context: parentNodeContext, subscribe: true })
  protected parentTransform: import("@babylonjs/core").TransformNode | null = null;

  @consume({ context: iconProviderContext, subscribe: true })
  protected iconProvider: IconProviderContext | null = null;

  protected readonly childContextProvider = new ContextProvider(this, {
    context: parentNodeContext,
    initialValue: null,
  });

  protected shapeNode: OmShapeNode | null = null;
  private currentTextureToken: symbol | null = null;

  protected abstract babylonNodeName(): string;

  /** Hook for subclasses to add extra Babylon geometry to the shape. */
  protected onShapeNodeReady(_node: OmShapeNode): void {
    /* default: no-op */
  }

  /**
   * Z-axis offset (in parent local units) used to layer entities. The
   * default `0` puts components on the diagram plane; subclasses
   * override to lift themselves slightly toward the camera (which sits
   * on +Z), e.g. connectors render on top of components.
   */
  protected zOffset(): number {
    return 0;
  }

  override render() {
    return html`<slot></slot>`;
  }

  override updated(_changed: Map<string, unknown>): void {
    this.ensureShapeNode();
    if (this.shapeNode) {
      this.shapeNode.setPlacement(
        this.placement,
        this.coordinateSystem,
        this.zOffset(),
      );
      this.shapeNode.setSelected(this.selected);
      this.refreshTexture();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.currentTextureToken = null;
    this.shapeNode?.dispose();
    this.shapeNode = null;
    this.childContextProvider.setValue(null);
  }

  private ensureShapeNode(): void {
    if (this.shapeNode) {
      return;
    }
    const parent = this.parentTransform;
    if (!parent) {
      return;
    }
    const scene = parent.getScene();
    this.shapeNode = new OmShapeNode(scene, parent, this.babylonNodeName());
    this.childContextProvider.setValue(this.shapeNode.transform);
    this.onShapeNodeReady(this.shapeNode);
  }

  private refreshTexture(): void {
    const node = this.shapeNode;
    const provider = this.iconProvider;
    if (!node) {
      return;
    }
    if (!provider || this.layers.length === 0) {
      node.setTexture(null);
      this.currentTextureToken = null;
      return;
    }
    const token = Symbol();
    this.currentTextureToken = token;
    provider
      .textureForLayers(this.layers, this.coordinateSystem)
      .then((tex) => {
        if (this.currentTextureToken === token && this.shapeNode) {
          this.shapeNode.setTexture(tex);
        }
      })
      .catch(() => {
        if (this.currentTextureToken === token && this.shapeNode) {
          this.shapeNode.setTexture(null);
        }
      });
  }
}
