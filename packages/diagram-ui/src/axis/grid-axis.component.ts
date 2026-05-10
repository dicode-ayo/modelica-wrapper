import { LitElement, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { Color3, TransformNode } from "@babylonjs/core";

import { sceneContext, type SceneContext } from "../scene/scene-context.js";
import {
  DEFAULT_GRID_OPTIONS,
  buildGrid,
  type GridMeshes,
  type GridOptions,
} from "./grid-build.js";

/**
 * `<om-grid-axis>` — renders the underlay grid + axis lines into the
 * scene's `worldRoot`. Place it as a direct child of `<om-scene>`:
 *
 *     <om-scene>
 *       <om-grid-axis></om-grid-axis>
 *       <!-- entities below -->
 *     </om-scene>
 *
 * The grid is static at construction (covers ±1000 diagram units by
 * default), which is enough for the typical zoom range. Later stages
 * may switch to a dynamic-regen scheme if extreme zoom-outs need
 * coverage.
 */
@customElement("om-grid-axis")
export class OmGridAxis extends LitElement {
  static override styles = css`
    :host {
      display: none;
    }
  `;

  @consume({ context: sceneContext, subscribe: true })
  private sceneCtx: SceneContext | null = null;

  /** Half-extent of the grid in diagram units. */
  @property({ type: Number }) extent = DEFAULT_GRID_OPTIONS.extent;

  /** Spacing between minor lines (diagram units). */
  @property({ type: Number, attribute: "minor-step" })
  minorStep = DEFAULT_GRID_OPTIONS.minorStep;

  /** Spacing between major lines (diagram units). */
  @property({ type: Number, attribute: "major-step" })
  majorStep = DEFAULT_GRID_OPTIONS.majorStep;

  /** CSS / hex string `#rrggbb` for the minor lines (else default slate). */
  @property() minorColor: string | undefined = undefined;
  @property() majorColor: string | undefined = undefined;
  @property() axisColor: string | undefined = undefined;

  private meshes: GridMeshes | null = null;
  private ownNode: TransformNode | null = null;

  override render() {
    return nothing;
  }

  override updated(): void {
    this.rebuild();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.disposeMeshes();
  }

  private rebuild(): void {
    this.disposeMeshes();
    const ctx = this.sceneCtx;
    if (!ctx) {
      return;
    }
    this.ownNode = new TransformNode("om-grid-axis", ctx.scene);
    this.ownNode.parent = ctx.worldRoot;
    const options: GridOptions = {
      extent: this.extent,
      minorStep: this.minorStep,
      majorStep: this.majorStep,
      minorColor: parseColor(this.minorColor) ?? DEFAULT_GRID_OPTIONS.minorColor,
      majorColor: parseColor(this.majorColor) ?? DEFAULT_GRID_OPTIONS.majorColor,
      axisColor: parseColor(this.axisColor) ?? DEFAULT_GRID_OPTIONS.axisColor,
    };
    this.meshes = buildGrid(ctx.scene, this.ownNode, options);
  }

  private disposeMeshes(): void {
    if (this.meshes) {
      this.meshes.minor.dispose(false, true);
      this.meshes.major.dispose(false, true);
      this.meshes.axes.dispose(false, true);
      this.meshes = null;
    }
    if (this.ownNode) {
      this.ownNode.dispose(false, true);
      this.ownNode = null;
    }
  }

  get gridMeshes(): GridMeshes | null {
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
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  return new Color3(r, g, b);
}

declare global {
  interface HTMLElementTagNameMap {
    "om-grid-axis": OmGridAxis;
  }
}
