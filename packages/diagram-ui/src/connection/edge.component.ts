import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { Color3, type TransformNode } from "@babylonjs/core";
import type { Point } from "@modelica-wrapper/omc-client";

import { parentNodeContext } from "../base/parent-node-context.js";
import { buildEdge, DEFAULT_EDGE_COLOR } from "./edge-build.js";

/**
 * `<om-edge>` — renders a single connection route as a stroked
 * polyline (GreasedLine). Multiple `<om-edge>` elements compose into
 * a `<om-connection>` (D5) when a connection has multiple routes.
 *
 * Properties:
 *   - `path`     — diagram-coord waypoints (>=2 points)
 *   - `stroke`   — CSS-style `#rrggbb` colour, optional
 *   - `clocked`  — dashed pattern for synchronous-clock connections
 *   - `width`    — line width in pixels (`sizeAttenuation: false` so
 *                  zoom doesn't grow/shrink the stroke)
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
  @property({ type: Number }) width: number | undefined = undefined;

  @consume({ context: parentNodeContext, subscribe: true })
  private parentTransform: TransformNode | null = null;

  private mesh: ReturnType<typeof buildEdge> = null;

  override render() {
    return html``;
  }

  override updated(): void {
    this.rebuild();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.mesh?.dispose(false, true);
    this.mesh = null;
  }

  private rebuild(): void {
    if (!this.parentTransform) {
      return;
    }
    this.mesh?.dispose(false, true);
    this.mesh = null;
    if (this.path.length < 2) {
      return;
    }
    const scene = this.parentTransform.getScene();
    const color = parseColor(this.stroke);
    this.mesh = buildEdge(
      scene,
      this.parentTransform,
      `om-edge:${this.nodeId || "anon"}`,
      {
        points: this.path,
        clocked: this.clocked,
        color: color ?? DEFAULT_EDGE_COLOR,
        ...(this.width !== undefined ? { width: this.width } : {}),
      },
    );
    if (this.mesh) {
      this.mesh.metadata = { kind: "edge", nodeId: this.nodeId };
    }
  }

  get edgeMesh(): ReturnType<typeof buildEdge> {
    return this.mesh;
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
