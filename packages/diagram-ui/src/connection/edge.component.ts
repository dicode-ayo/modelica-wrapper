import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { Color3, type TransformNode } from "@babylonjs/core";
import type { Point } from "@modelica-wrapper/omc-client";

import { parentNodeContext } from "../base/parent-node-context.js";
import {
  DEFAULT_EDGE_COLOR,
  buildEdge,
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

  override render() {
    return html``;
  }

  override updated(changed: Map<string, unknown>): void {
    // Recreate the geometry if the path or visual options change;
    // selection is just a colour swap, no rebuild needed.
    if (
      changed.has("path") ||
      changed.has("stroke") ||
      changed.has("clocked") ||
      changed.has("nodeId") ||
      !this.meshes
    ) {
      this.rebuild();
    }
    this.applySelection();
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
  }

  private applySelection(): void {
    if (!this.meshes) {
      return;
    }
    this.meshes.line.color = this.selected
      ? SELECTED_EDGE_COLOR
      : this.baseColor;
  }

  private disposeMeshes(): void {
    if (!this.meshes) {
      return;
    }
    this.meshes.line.dispose(false, true);
    this.meshes.hitArea.dispose(false, true);
    this.meshes = null;
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
