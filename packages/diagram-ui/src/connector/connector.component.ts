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

  protected override babylonNodeName(): string {
    return this.nodeId ? `om-connector:${this.nodeId}` : "om-connector";
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
    disc.position.set(icon.cx, icon.cy, 0.01);
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
    }
  }

  get portIndicatorVisible(): boolean {
    return this.indicatorVisible;
  }

  override disconnectedCallback(): void {
    this.portIndicator?.dispose();
    this.portMaterial?.dispose();
    this.portIndicator = null;
    this.portMaterial = null;
    super.disconnectedCallback();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-connector": OmConnector;
  }
}
