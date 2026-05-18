import { LitElement, css, html, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { ContextProvider, consume } from "@lit/context";
import type {
  CoordinateSystem,
  IconLayer,
  Placement,
  Shape,
} from "@modelica-wrapper/omc-client";

import { parentNodeContext } from "./parent-node-context.js";
import { OmShapeNode } from "./shape-node.js";

// Side-effect imports register the `<om-*>` primitive custom elements
// for use from `render()` below. Each component file is import-once
// safe — they only call `customElements.define(...)` on first load.
import "../primitives/rectangle.component.js";
import "../primitives/polygon.component.js";
import "../primitives/line.component.js";
import "../primitives/ellipse.component.js";
import "../primitives/text.component.js";
import "../primitives/bitmap.component.js";

/**
 * Base class for `<om-component>`, `<om-connector>`, and other shape-
 * carrying entities. Bridges the Lit lifecycle to a Babylon `OmShapeNode`:
 *
 *  - Consumes the parent `TransformNode` from the Lit context.
 *  - Provides its own `TransformNode` as the parent context for
 *    children (`<om-rectangle>`, `<om-text>`, …, plus nested
 *    `<om-connector>` / labels) — children attach in the entity's
 *    local icon coordinate system.
 *  - Renders each shape in `layers` as a primitive custom element.
 *    Each primitive owns its own Babylon meshes and lifecycle, so an
 *    OMC roundtrip on a single shape only rebuilds that shape.
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

  /**
   * Stroke-width multiplier kept on the public API for forward-compat
   * with the previous SVG renderer. The primitives renderer currently
   * ignores it — line widths are taken directly from the Modelica
   * annotations. Kept as a property so existing host code that sets
   * it doesn't fail.
   */
  @property({ type: Number, attribute: "line-thickness-scale" })
  lineThicknessScale: number | undefined = undefined;

  /** Selection state — purely a flag for now (E2 wires visuals). */
  @property({ type: Boolean, reflect: true })
  selected = false;

  /** Read-only flag forwarded to the interaction manager in stage E. */
  @property({ type: Boolean, reflect: true })
  readonly = false;

  @consume({ context: parentNodeContext, subscribe: true })
  protected parentTransform: import("@babylonjs/core").TransformNode | null = null;

  protected readonly childContextProvider = new ContextProvider(this, {
    context: parentNodeContext,
    initialValue: null,
  });

  protected shapeNode: OmShapeNode | null = null;

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

  override render(): TemplateResult {
    const items: TemplateResult[] = [];
    let zOrder = 0;
    for (const layer of this.layers) {
      for (const shape of layer.shapes) {
        items.push(this.renderShape(shape, zOrder));
        zOrder++;
      }
    }
    return html`${items}<slot></slot>`;
  }

  private renderShape(shape: Shape, zOrder: number): TemplateResult {
    switch (shape.kind) {
      case "rectangle":
        return html`<om-rectangle
          .shape=${shape}
          .zOrder=${zOrder}
        ></om-rectangle>`;
      case "polygon":
        return html`<om-polygon
          .shape=${shape}
          .zOrder=${zOrder}
        ></om-polygon>`;
      case "line":
        return html`<om-line .shape=${shape} .zOrder=${zOrder}></om-line>`;
      case "ellipse":
        return html`<om-ellipse
          .shape=${shape}
          .zOrder=${zOrder}
        ></om-ellipse>`;
      case "text":
        return html`<om-text .shape=${shape} .zOrder=${zOrder}></om-text>`;
      case "bitmap":
        return html`<om-bitmap
          .shape=${shape}
          .zOrder=${zOrder}
        ></om-bitmap>`;
      default: {
        const _exhaustive: never = shape;
        void _exhaustive;
        return html``;
      }
    }
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
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
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
}
