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
import { setMeshHighlight } from "../base/selection-overlay.js";
import { requestSceneRender } from "../scene/render-scheduler.js";
import { pointsEqual } from "../interaction/connection-route.js";
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
  /**
   * Last waypoint list the junctions were built against. Compared by
   * content so a fresh-but-equal `path` (typical after an OMC layout
   * roundtrip) doesn't dispose + recreate the junction discs. Also
   * acts as the "first build" sentinel so we don't keep re-running
   * `rebuildJunctions()` every `updated()` when there are no internal
   * waypoints (empty `junctionMeshes`).
   */
  private builtPath: Point[] | null = null;

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
    const visualChanged =
      changed.has("stroke") ||
      changed.has("nodeId") ||
      changed.has("showJunctions") ||
      changed.has("junctionRadius");
    const pathChanged =
      changed.has("path") && !pointsEqual(this.path, this.builtPath);
    if (this.builtPath === null || visualChanged || pathChanged) {
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
    this.builtPath = this.path;
    if (!this.showJunctions || !this.parentTransform) {
      return;
    }
    const scene = this.parentTransform.getScene();
    const internal = this.path.slice(1, -1);
    if (internal.length === 0) {
      requestSceneRender(scene);
      return;
    }
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
    requestSceneRender(scene);
  }

  private applyJunctionSelection(): void {
    const parent = this.parentTransform;
    if (!parent) {
      return;
    }
    const scene = parent.getScene();
    // Remove highlights that no longer apply.
    for (const mesh of [...this.highlightedJunctions]) {
      const id = (mesh.metadata as { nodeId?: string } | null)?.nodeId;
      if (id && !this.selectedKeys.has(`junc:${id}`)) {
        setMeshHighlight(scene, mesh, null);
        this.highlightedJunctions.delete(mesh);
      }
    }
    // Add highlights for newly-selected junctions.
    for (const mesh of this.junctionMeshes) {
      const id = (mesh.metadata as { nodeId?: string } | null)?.nodeId;
      if (id && this.selectedKeys.has(`junc:${id}`)) {
        if (!this.highlightedJunctions.has(mesh)) {
          setMeshHighlight(scene, mesh, SELECTED_COLOR);
          this.highlightedJunctions.add(mesh);
        }
      }
    }
  }

  private disposeJunctions(): void {
    const parent = this.parentTransform;
    const scene = parent ? parent.getScene() : null;
    for (const m of this.junctionMeshes) {
      if (scene && this.highlightedJunctions.has(m)) {
        setMeshHighlight(scene, m, null);
      }
      m.dispose();
    }
    this.junctionMeshes = [];
    this.highlightedJunctions.clear();
    this.junctionMaterial?.dispose();
    this.junctionMaterial = null;
    // Clear the "built against" sentinel so a reconnect (or any next
    // `rebuildJunctions`) starts from a clean slate. `rebuildJunctions`
    // re-sets it immediately after calling us; the order is fine.
    this.builtPath = null;
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
