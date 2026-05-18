import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { Color3, type TransformNode } from "@babylonjs/core";
import type { Point } from "@modelica-wrapper/omc-client";

import { parentNodeContext } from "../base/parent-node-context.js";
import { requestSceneRender } from "../scene/render-scheduler.js";
import { pointsEqual } from "../interaction/connection-route.js";
import {
  DEFAULT_EDGE_COLOR,
  buildEdge,
  rebuildHitTube,
  updateEdgePoints,
  type EdgeMeshes,
} from "./edge-build.js";

/** Highlight colour applied to the visible line when the edge is selected. */
const SELECTED_EDGE_COLOR = new Color3(0.24, 0.51, 0.96); // blue-500

/**
 * `<om-edge>` — renders a single connection route as a 1-pixel GL
 * `LinesMesh` (or `DashedLinesMesh` when `clocked`), plus an invisible
 * tube-shaped hit-area mesh so `scene.pick` can actually hit it.
 *
 * Properties:
 *   - `path`     — diagram-coord waypoints (>=2 points)
 *   - `stroke`   — CSS-style `#rrggbb` colour, optional
 *   - `clocked`  — dashed pattern for synchronous-clock connections
 *   - `selected` — when true, the visible line switches to the
 *                  selected highlight colour
 */
@customElement("om-edge")
export class OmEdge extends LitElement {
  static override styles = css`
    :host {
      display: none;
    }
  `;

  @property() nodeId = "";
  @property({ attribute: false }) path: Point[] = [];
  @property() stroke: string | undefined = undefined;
  @property({ type: Boolean }) clocked = false;
  @property({ type: Boolean }) selected = false;

  @consume({ context: parentNodeContext, subscribe: true })
  private parentTransform: TransformNode | null = null;

  private meshes: EdgeMeshes | null = null;
  private baseColor: Color3 = DEFAULT_EDGE_COLOR;
  /**
   * Last waypoint list actually applied to the LinesMesh. Compared by
   * content (not reference) so that an OMC-roundtripped layout that
   * produces a fresh-but-equal `path` array is recognised as a no-op
   * and skips the dispose/rebuild — see `pointsEqual` for the why.
   */
  private builtPath: Point[] | null = null;

  override render() {
    return html``;
  }

  override updated(changed: Map<string, unknown>): void {
    // Recreate the geometry on visual-option changes; for path-only
    // changes prefer an in-place vertex update so a component drag
    // (which shifts every connected edge's waypoints each pointermove)
    // doesn't churn the GPU buffers. Selection is a colour swap on the
    // existing mesh, never a rebuild.
    const visualChanged =
      changed.has("stroke") ||
      changed.has("clocked") ||
      changed.has("nodeId");
    const pathChanged =
      changed.has("path") && !pointsEqual(this.path, this.builtPath);
    if (!this.meshes || visualChanged) {
      this.rebuild();
    } else if (pathChanged) {
      if (!this.tryUpdateInPlace()) {
        this.rebuild();
      }
    }
    this.applySelection();
  }

  /**
   * Update the vertex buffer of the existing LinesMesh without
   * disposing it. Returns `false` when the new path has a different
   * number of points than the existing mesh was built with — Babylon's
   * `instance` parameter on `CreateLines` rejects topology changes, so
   * the caller must fall back to a full rebuild in that case.
   *
   * The hit tube (invisible merged mesh) can't be updated this way and
   * is rebuilt anyway. Because it's invisible the rebuild costs nothing
   * visually, only a small GPU upload.
   */
  private tryUpdateInPlace(): boolean {
    if (!this.meshes || !this.builtPath || !this.parentTransform) {
      return false;
    }
    if (this.path.length !== this.builtPath.length) {
      return false;
    }
    const scene = this.parentTransform.getScene();
    updateEdgePoints(scene, this.meshes.line, this.path, this.clocked);
    const meta = this.meshes.hitArea.metadata;
    this.meshes.hitArea.dispose(false, true);
    this.meshes.hitArea = rebuildHitTube(
      scene,
      this.parentTransform,
      `om-edge:${this.nodeId || "anon"}.hit`,
      this.path,
    );
    this.meshes.hitArea.metadata = meta;
    this.builtPath = this.path;
    requestSceneRender(scene);
    return true;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.disposeMeshes();
  }

  private rebuild(): void {
    if (!this.parentTransform) {
      return;
    }
    this.disposeMeshes();
    if (this.path.length < 2) {
      this.builtPath = null;
      return;
    }
    const scene = this.parentTransform.getScene();
    this.baseColor = parseColor(this.stroke) ?? DEFAULT_EDGE_COLOR;
    this.meshes = buildEdge(
      scene,
      this.parentTransform,
      `om-edge:${this.nodeId || "anon"}`,
      {
        points: this.path,
        clocked: this.clocked,
        color: this.baseColor,
      },
    );
    if (this.meshes) {
      const meta = { kind: "edge", nodeId: this.nodeId };
      this.meshes.line.metadata = meta;
      this.meshes.hitArea.metadata = meta;
    }
    this.builtPath = this.path;
  }

  private applySelection(): void {
    if (!this.meshes) {
      return;
    }
    this.meshes.line.color = this.selected
      ? SELECTED_EDGE_COLOR
      : this.baseColor;
    requestSceneRender(this.meshes.line.getScene());
  }

  private disposeMeshes(): void {
    if (!this.meshes) {
      return;
    }
    this.meshes.line.dispose(false, true);
    this.meshes.hitArea.dispose(false, true);
    this.meshes = null;
    this.builtPath = null;
  }

  /** Test accessors. */
  get edgeMesh(): EdgeMeshes | null {
    return this.meshes;
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
    "om-edge": OmEdge;
  }
}
