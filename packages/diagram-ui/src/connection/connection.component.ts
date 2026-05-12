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
import { ensureHighlightLayer } from "../base/selection-overlay.js";
import "./edge.component.js";

const JUNCTION_BASE_COLOR = new Color3(0.1, 0.1, 0.18);
const SELECTED_COLOR = new Color3(0.24, 0.51, 0.96); // blue-500, matches edges

/**
 * `<om-connection>` — composes one `<om-edge>` with optional junction
 * markers at internal waypoints. Our `DiagramLayout` schema doesn't
 * model junctions explicitly (a connection has a single waypoint
 * list); we draw a small marker at each internal corner so a many-
 * segment connection reads as one routed line, not a polygon.
 *
 * Properties:
 *   - `path`             — `Point[]` of waypoints
 *   - `stroke`           — `#rrggbb` colour, forwarded to <om-edge>
 *   - `clocked`          — dashed pattern, forwarded
 *   - `showJunctions`    — render a dot at each internal waypoint
 *   - `selectedKeys`     — set of entity keys (`edge:<nodeId>` and
 *                          `junc:<nodeId>/<waypointIdx>`) that are
 *                          currently selected; drives the highlight
 *                          colour on the edge + HighlightLayer entry
 *                          on each junction.
 *
 * Endpoint dots (first / last) are deliberately NOT drawn — the
 * connectors at each end already provide the visual terminator.
 *
 * Junction metadata uses a compound nodeId of
 * `<connectionNodeId>/<waypointIndex>` so the interaction layer can
 * distinguish different junctions on the same connection.
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
  @property({ attribute: false })
  selectedKeys: Set<string> = new Set();

  @consume({ context: parentNodeContext, subscribe: true })
  private parentTransform: TransformNode | null = null;

  private junctionMeshes: Mesh[] = [];
  private junctionMaterial: StandardMaterial | null = null;
  private highlightedJunctions = new Set<Mesh>();

  override render() {
    if (this.path.length < 2) {
      return html``;
    }
    return html`<om-edge
      nodeId=${`${this.nodeId}/edge`}
      .path=${this.path}
      .stroke=${this.stroke}
      ?clocked=${this.clocked}
      ?selected=${this.selectedKeys.has(`edge:${this.nodeId}`)}
    ></om-edge>`;
  }

  override updated(changed: Map<string, unknown>): void {
    if (
      changed.has("path") ||
      changed.has("stroke") ||
      changed.has("nodeId") ||
      changed.has("showJunctions") ||
      changed.has("junctionRadius") ||
      this.junctionMeshes.length === 0
    ) {
      this.rebuildJunctions();
    }
    this.applyJunctionSelection();
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
    this.junctionMaterial = new StandardMaterial("om-junction-mat", scene);
    this.junctionMaterial.disableLighting = true;
    this.junctionMaterial.emissiveColor =
      parseColor(stroke) ?? JUNCTION_BASE_COLOR;

    // Internal waypoints map to `path` indices 1 .. path.length - 2.
    let waypointIdx = 1;
    for (const [x, y] of internal) {
      const compoundId = `${this.nodeId}/${waypointIdx}`;
      const disc = MeshBuilder.CreateDisc(
        `om-junction:${compoundId}`,
        { radius: this.junctionRadius, tessellation: 16 },
        scene,
      );
      disc.material = this.junctionMaterial;
      disc.parent = this.parentTransform;
      // Negative z = closer to camera (sits at -Z) so the junction
      // dot paints on top of the edge line.
      disc.position.set(x, y, -0.01);
      disc.metadata = { kind: "junction", nodeId: compoundId };
      disc.isPickable = true;
      this.junctionMeshes.push(disc);
      waypointIdx++;
    }
  }

  private applyJunctionSelection(): void {
    const parent = this.parentTransform;
    if (!parent) {
      return;
    }
    const layer = ensureHighlightLayer(parent.getScene());
    // Remove highlights that no longer apply.
    for (const mesh of [...this.highlightedJunctions]) {
      const id = (mesh.metadata as { nodeId?: string } | null)?.nodeId;
      if (id && !this.selectedKeys.has(`junc:${id}`)) {
        layer?.removeMesh(mesh);
        this.highlightedJunctions.delete(mesh);
      }
    }
    // Add highlights for newly-selected junctions.
    for (const mesh of this.junctionMeshes) {
      const id = (mesh.metadata as { nodeId?: string } | null)?.nodeId;
      if (id && this.selectedKeys.has(`junc:${id}`)) {
        if (!this.highlightedJunctions.has(mesh)) {
          layer?.addMesh(mesh, SELECTED_COLOR);
          this.highlightedJunctions.add(mesh);
        }
      }
    }
  }

  private disposeJunctions(): void {
    const parent = this.parentTransform;
    const layer = parent ? ensureHighlightLayer(parent.getScene()) : null;
    for (const m of this.junctionMeshes) {
      if (layer && this.highlightedJunctions.has(m)) {
        layer.removeMesh(m);
      }
      m.dispose();
    }
    this.junctionMeshes = [];
    this.highlightedJunctions.clear();
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
