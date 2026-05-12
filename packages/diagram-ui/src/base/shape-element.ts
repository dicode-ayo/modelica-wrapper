import { LitElement, css, html } from "lit";
import { property } from "lit/decorators.js";
import { ContextProvider, consume } from "@lit/context";
import type {
  CoordinateSystem,
  IconLayer,
  Placement,
} from "@modelica-wrapper/omc-client";

import { parentNodeContext } from "./parent-node-context.js";
import { OmShapeNode } from "./shape-node.js";

/**
 * Base class for `<om-component>`, `<om-connector>`, and other shape-
 * carrying entities. Bridges the Lit lifecycle to a Babylon `OmShapeNode`:
 *
 *  - Consumes the parent `TransformNode` from the Lit context.
 *  - Hands `layers` + `coordinateSystem` to `OmShapeNode.setLayers`,
 *    which builds native Babylon meshes per shape (rectangles,
 *    polygons, lines, ellipses, text, bitmaps).
 *  - Provides its own `TransformNode` as the parent context for
 *    children (nested connectors, labels) — children attach in the
 *    entity's local icon coordinate system.
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
  private lastBuiltLayers: IconLayer[] | null = null;
  private lastBuiltCoordSystem: CoordinateSystem | undefined = undefined;

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
      this.refreshLayers();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.lastBuiltLayers = null;
    this.lastBuiltCoordSystem = undefined;
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

  /**
   * Rebuild the shape meshes only if `layers` / `coordinateSystem`
   * changed by reference. Identity-based comparison: producers emit
   * stable references for unchanged layers, so the common case where
   * only placement changes does not pay for a mesh rebuild.
   */
  private refreshLayers(): void {
    const node = this.shapeNode;
    if (!node) {
      return;
    }
    if (
      this.lastBuiltLayers === this.layers &&
      this.lastBuiltCoordSystem === this.coordinateSystem
    ) {
      return;
    }
    this.lastBuiltLayers = this.layers;
    this.lastBuiltCoordSystem = this.coordinateSystem;
    node.setLayers(this.layers, this.coordinateSystem);
  }
}
