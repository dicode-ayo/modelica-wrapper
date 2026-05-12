import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { consume } from "@lit/context";
import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  type Mesh,
  type TransformNode,
} from "@babylonjs/core";
import type { Point } from "@modelica-wrapper/omc-client";

import { parentNodeContext } from "../base/parent-node-context.js";
import "./edge.component.js";

/**
 * `<om-connection>` — composes one `<om-edge>` with optional junction
 * markers at internal waypoints. Our `DiagramLayout` schema doesn't
 * model junctions explicitly (a connection has a single waypoint list);
 * we still draw a small marker at each internal corner so a many-
 * segment connection reads as one routed line, not a polygon.
 *
 * Properties:
 *   - `path`             — `Point[]` of waypoints
 *   - `stroke`           — `#rrggbb` colour, forwarded to <om-edge>
 *   - `clocked`          — dashed pattern, forwarded
 *   - `showJunctions`    — render a dot at each internal waypoint
 *
 * Endpoint dots (first / last) are deliberately NOT drawn — the
 * connectors at each end already provide the visual terminator.
 */
@customElement("om-connection")
export class OmConnection extends LitElement {
  static override styles = css`
    :host {
      display: none;
    }
  `;

  @property() nodeId = "";
  @property({ attribute: false }) path: Point[] = [];
  @property() stroke: string | undefined = undefined;
  @property({ type: Boolean }) clocked = false;
  @property({ type: Boolean, attribute: "show-junctions" })
  showJunctions = true;
  @property({ type: Number, attribute: "junction-radius" })
  junctionRadius = 1.5;

  @consume({ context: parentNodeContext, subscribe: true })
  private parentTransform: TransformNode | null = null;

  private junctionMeshes: Mesh[] = [];
  private junctionMaterial: StandardMaterial | null = null;

  override render() {
    if (this.path.length < 2) {
      return html``;
    }
    return html`<om-edge
      nodeId=${`${this.nodeId}/edge`}
      .path=${this.path}
      .stroke=${this.stroke}
      ?clocked=${this.clocked}
    ></om-edge>`;
  }

  override updated(): void {
    this.rebuildJunctions();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.disposeJunctions();
  }

  private rebuildJunctions(): void {
    this.disposeJunctions();
    if (!this.showJunctions || !this.parentTransform) {
      return;
    }
    const internal = this.path.slice(1, -1);
    if (internal.length === 0) {
      return;
    }
    const scene = this.parentTransform.getScene();
    const stroke = this.stroke;
    if (!this.junctionMaterial) {
      this.junctionMaterial = new StandardMaterial("om-junction-mat", scene);
      this.junctionMaterial.disableLighting = true;
      const c = parseColor(stroke) ?? new Color3(0.1, 0.1, 0.18);
      this.junctionMaterial.emissiveColor = c;
    }
    for (const [x, y] of internal) {
      const disc = MeshBuilder.CreateDisc(
        `om-junction:${this.nodeId}`,
        { radius: this.junctionRadius, tessellation: 16 },
        scene,
      );
      disc.material = this.junctionMaterial;
      disc.parent = this.parentTransform;
      // Slightly more negative z than EDGE_Z_OFFSET (-0.005) so the
      // junction dot paints on top of the edge line. Camera at -Z =
      // more-negative z is closer to camera = drawn over.
      disc.position.set(x, y, -0.01);
      disc.metadata = { kind: "junction", nodeId: this.nodeId };
      this.junctionMeshes.push(disc);
    }
  }

  private disposeJunctions(): void {
    for (const m of this.junctionMeshes) {
      m.dispose();
    }
    this.junctionMeshes = [];
    this.junctionMaterial?.dispose();
    this.junctionMaterial = null;
  }

  get junctions(): Mesh[] {
    return this.junctionMeshes;
  }
}

function parseColor(input: string | undefined): Color3 | undefined {
  if (!input) {
    return undefined;
  }
  const m = input.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) {
    return undefined;
  }
  const hex = m[1]!;
  return new Color3(
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  );
}

declare global {
  interface HTMLElementTagNameMap {
    "om-connection": OmConnection;
  }
}
