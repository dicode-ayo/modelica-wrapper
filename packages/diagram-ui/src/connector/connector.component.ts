import { css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Circle, Graphics } from "pixi.js";

import { OmShapeElement } from "../base/shape-element.js";
import type { OmShapeNode } from "../base/shape-node.js";
import { coordSystemSize } from "../base/placement-math.js";
import { setHighlight } from "../base/selection-overlay.js";
import { tagEntity } from "../interaction/node-keys.js";

/** Port-indicator fill — translucent blue-400. */
const PORT_INDICATOR_COLOR = 0x6199fa;
const PORT_INDICATOR_ALPHA = 0.45;
/** Radius of the port disc as a fraction of the smaller icon dimension. */
const PORT_RADIUS_FRACTION = 0.22;
/** Paint band lifting the indicator above the icon, below the selection
 *  outline / handles. */
const PORT_INDICATOR_Z_INDEX = 5;

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

  private portIndicator: Graphics | null = null;
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

  protected override entityNodeName(): string {
    return this.nodeId ? `om-connector:${this.nodeId}` : "om-connector";
  }

  /**
   * Connectors paint on top of components. The default `0` puts an entity
   * on the diagram plane; a more-negative offset lifts it in front
   * (`OmShapeNode` inverts the sign into a `zIndex`), so the routed
   * connectors sit above the components they terminate on.
   */
  protected override zOffset(): number {
    return -1.5;
  }

  override updated(changed: Map<string, unknown>): void {
    super.updated(changed);
    // Re-assert hover outline. `OmShapeElement.updated()` runs
    // `shapeNode.setSelected(this.selected)`, which can flip the highlight
    // membership for our hit plane; the next pass restores hover if the
    // user is still pointing at us.
    if (this.hovered) {
      this.hoverLayerAttached = false;
      this.hoverLayerColor = null;
      this.applyHoverOutline();
    }
  }

  protected override onShapeNodeReady(node: OmShapeNode): void {
    const icon = coordSystemSize(this.coordinateSystem);
    const radius = Math.min(icon.width, icon.height) * PORT_RADIUS_FRACTION;

    const disc = new Graphics();
    disc.circle(0, 0, radius).fill({
      color: PORT_INDICATOR_COLOR,
      alpha: PORT_INDICATOR_ALPHA,
    });
    disc.position.set(icon.cx, icon.cy);
    disc.zIndex = PORT_INDICATOR_Z_INDEX;
    disc.visible = false;
    disc.eventMode = "static";
    disc.hitArea = new Circle(0, 0, radius);
    // The port disc resolves to a `port` identity; the picker walks up to
    // the owning connector via the parent chain (nested-connector aware).
    tagEntity(disc, "port", this.nodeId);
    node.transform.addChild(disc);
    this.portIndicator = disc;
  }

  /** Toggle the hover affordance; called by the interaction manager. */
  setPortIndicatorVisible(visible: boolean): void {
    this.indicatorVisible = visible;
    if (this.portIndicator) {
      this.portIndicator.visible = visible;
      this.sceneCtx?.requestRender();
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
    const ctx = this.sceneCtx;
    if (!node || !ctx) {
      return;
    }
    // `setSelected` already manages this hit plane with the brighter
    // selection colour. Don't fight it — when the user selects + hovers
    // the same connector, the selection outline wins; we restore the
    // hover outline on un-select.
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
    setHighlight(
      ctx,
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
   * Diagram-space position of the connector's port (the entity origin,
   * transformed by every ancestor placement). Returns `null` if the shape
   * node hasn't been mounted yet.
   *
   * Used by the host element to anchor the rubber-band edge while the
   * user drags a connection out of this port.
   */
  getPortDiagramPosition(): { x: number; y: number } | null {
    const t = this.shapeNode?.transform;
    const ctx = this.sceneCtx;
    if (!t || !ctx) {
      return null;
    }
    const local = ctx.diagramRoot.toLocal(t.getGlobalPosition());
    return { x: local.x, y: local.y };
  }

  override disconnectedCallback(): void {
    // Remove the hover outline before the base class disposes the hit
    // plane — the highlight registry holds a container reference and
    // would redraw against a destroyed container otherwise.
    if (this.hoverLayerAttached && this.shapeNode && this.sceneCtx) {
      setHighlight(this.sceneCtx, this.shapeNode.mesh, null);
      this.hoverLayerAttached = false;
    }
    this.portIndicator?.destroy();
    this.portIndicator = null;
    super.disconnectedCallback();
  }
}

/** Softer blue than the selection outline (blue-300). */
const HOVER_COLOR = 0x9cc7ff;
/** Red glow used when the connector is an incompatible drop target (red-400). */
const HOVER_ERROR_COLOR = 0xf77070;

declare global {
  interface HTMLElementTagNameMap {
    "om-connector": OmConnector;
  }
}
