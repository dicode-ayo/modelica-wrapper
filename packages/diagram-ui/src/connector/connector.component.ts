import { css } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  type Mesh,
} from "@babylonjs/core";

import { OmShapeElement } from "../base/shape-element.js";
import type { OmShapeNode } from "../base/shape-node.js";
import { coordSystemSize } from "../base/placement-math.js";
import { setMeshHighlight } from "../base/selection-overlay.js";
import { requestSceneRender } from "../scene/render-scheduler.js";

/**
 * `<om-connector>` — connector port. Behaves like `<om-component>` but
 * adds a port-indicator disc that the interaction manager (stage E1)
 * uses as the "drag-here-to-make-a-connection" affordance. The disc is
 * hidden by default and toggled via `setPortIndicatorVisible(bool)`
 * (called by the hover handler in stage E).
 *
 * Composition rules:
 *   - Standalone connectors on the host class go directly under
 *     `<om-scene>` (or under `<om-graphical-layout>` in F1).
 *   - Nested connectors live inside the parent `<om-component>` so
 *     their placement is in the component's class icon-coord system.
 *
 * `hitMultiplier` is reserved for stage E1's picking: nested connectors
 * use a fattened invisible hit area so they remain easy to grab even at
 * small zoom levels.
 */
@customElement("om-connector")
export class OmConnector extends OmShapeElement {
  static override styles = css`
    :host {
      display: contents;
    }
  `;

  @property() nodeId = "";
  @property({ type: Number, attribute: "hit-multiplier" })
  hitMultiplier = 1;

  private portIndicator: Mesh | null = null;
  private portMaterial: StandardMaterial | null = null;
  private indicatorVisible = false;
  private hovered = false;
  /**
   * Hover variant. `"error"` paints the outline red so the user sees
   * the target is an incompatible connection drop (e.g. input ↔ input).
   * Set together with `hovered=true`.
   */
  private hoverVariant: "normal" | "error" = "normal";
  private hoverLayerAttached = false;
  private hoverLayerColor: "normal" | "error" | null = null;

  protected override babylonNodeName(): string {
    return this.nodeId ? `om-connector:${this.nodeId}` : "om-connector";
  }

  /**
   * Connectors paint on top of components by lifting their TransformNode
   * a fraction toward the camera. The camera sits at -Z, so "toward
   * the camera" is *negative* z — hence the negative value. The
   * host-coord units used here are tiny compared to entity sizes so
   * the offset is invisible geometrically — only the depth ordering
   * changes.
   *
   * Note: the offset stacks with the parent component's local scaling,
   * so the actual world delta is `parent.scale * 1.5`. Even on a very
   * small component (`scale = 0.01`) that still gives 0.015 world units
   * of separation — comfortably above the ortho depth-test resolution.
   */
  protected override zOffset(): number {
    return -1.5;
  }

  override updated(changed: Map<string, unknown>): void {
    super.updated(changed);
    // Re-assert hover outline. `OmShapeElement.updated()` runs
    // `shapeNode.setSelected(this.selected)`, which can flip the
    // HighlightLayer membership for our mesh; the next pass through
    // this method restores hover if the user is still pointing at us.
    if (this.hovered) {
      this.hoverLayerAttached = false;
      this.hoverLayerColor = null;
      this.applyHoverOutline();
    }
  }

  protected override onShapeNodeReady(node: OmShapeNode): void {
    const scene = node.transform.getScene();
    const icon = coordSystemSize(this.coordinateSystem);
    const radius = Math.min(icon.width, icon.height) * 0.22;
    const mat = new StandardMaterial("om-port-mat", scene);
    mat.disableLighting = true;
    mat.emissiveColor = new Color3(0.38, 0.6, 0.98); // blue-400
    mat.alpha = 0.45;
    this.portMaterial = mat;

    const disc = MeshBuilder.CreateDisc(
      "om-port-indicator",
      { radius, tessellation: 32 },
      scene,
    );
    disc.material = mat;
    disc.parent = node.transform;
    // Negative z = closer to camera (sits at -Z) so the port
    // indicator paints on top of the connector icon plane.
    disc.position.set(icon.cx, icon.cy, -0.01);
    disc.isVisible = false;
    disc.isPickable = true;
    disc.metadata = { kind: "port" };
    this.portIndicator = disc;
  }

  /** Toggle the hover affordance; called by the interaction manager. */
  setPortIndicatorVisible(visible: boolean): void {
    this.indicatorVisible = visible;
    if (this.portIndicator) {
      this.portIndicator.isVisible = visible;
      requestSceneRender(this.portIndicator.getScene());
    }
  }

  get portIndicatorVisible(): boolean {
    return this.indicatorVisible;
  }

  /**
   * Outline the connector icon to signal it's clickable. The
   * `variant` lets the host distinguish a normal hover (blue) from
   * the snap target during a connection drag (`"error"` = red, used
   * when the type/causality check rejects the drop).
   *
   * Independent of `setPortIndicatorVisible` — the port indicator is
   * the click *target*, the hover outline is the click *affordance*.
   * The two are toggled together by the host element but kept apart
   * on the connector itself so a test can drive them in isolation.
   */
  setHovered(hovered: boolean, variant: "normal" | "error" = "normal"): void {
    if (this.hovered === hovered && this.hoverVariant === variant) {
      return;
    }
    this.hovered = hovered;
    this.hoverVariant = variant;
    this.applyHoverOutline();
  }

  get isHovered(): boolean {
    return this.hovered;
  }

  get hoveredVariant(): "normal" | "error" {
    return this.hoverVariant;
  }

  private applyHoverOutline(): void {
    const node = this.shapeNode;
    if (!node) {
      return;
    }
    const scene = node.transform.getScene();
    // `setSelected` already manages this mesh in the HighlightLayer
    // with the brighter selection colour. Don't fight it — when the
    // user selects + hovers the same connector, the selection
    // outline wins; we restore the hover outline on un-select.
    if (node.isSelected()) {
      this.hoverLayerAttached = false;
      this.hoverLayerColor = null;
      return;
    }
    const wantColor: "normal" | "error" | null = this.hovered
      ? this.hoverVariant
      : null;
    if (wantColor === this.hoverLayerColor) {
      return;
    }
    setMeshHighlight(
      scene,
      node.mesh,
      wantColor === null
        ? null
        : wantColor === "error"
          ? HOVER_ERROR_COLOR
          : HOVER_COLOR,
    );
    this.hoverLayerAttached = wantColor !== null;
    this.hoverLayerColor = wantColor;
  }

  /**
   * Diagram-space position of the connector's port (centre of the icon
   * coord system, transformed by every ancestor placement). Returns
   * `null` if the shape node hasn't been mounted yet.
   *
   * Used by the host element to anchor the rubber-band edge while the
   * user drags a connection out of this port.
   */
  getPortDiagramPosition(): { x: number; y: number } | null {
    const t = this.shapeNode?.transform;
    if (!t) {
      return null;
    }
    t.computeWorldMatrix(true);
    const p = t.getAbsolutePosition();
    return { x: p.x, y: p.y };
  }

  override disconnectedCallback(): void {
    // Remove the hover outline before the underlying mesh is disposed
    // by the base class — HighlightLayer holds a mesh reference and
    // will crash on next render if the mesh vanishes while still in
    // the layer.
    if (this.hoverLayerAttached && this.shapeNode) {
      setMeshHighlight(
        this.shapeNode.transform.getScene(),
        this.shapeNode.mesh,
        null,
      );
      this.hoverLayerAttached = false;
    }
    this.portIndicator?.dispose();
    this.portMaterial?.dispose();
    this.portIndicator = null;
    this.portMaterial = null;
    super.disconnectedCallback();
  }
}

/** Softer blue than the selection outline. */
const HOVER_COLOR = new Color3(0.61, 0.78, 1); // blue-300
/** Red glow used when the connector is an incompatible drop target. */
const HOVER_ERROR_COLOR = new Color3(0.97, 0.44, 0.44); // red-400

declare global {
  interface HTMLElementTagNameMap {
    "om-connector": OmConnector;
  }
}
