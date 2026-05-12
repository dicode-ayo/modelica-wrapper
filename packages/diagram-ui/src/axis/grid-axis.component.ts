import { LitElement, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { Color3, TransformNode } from "@babylonjs/core";
import type { CoordinateSystem } from "@modelica-wrapper/omc-client";

import { sceneContext, type SceneContext } from "../scene/scene-context.js";
import {
  DEFAULT_GRID_OPTIONS,
  buildGrid,
  type GridMeshes,
  type GridOptions,
} from "./grid-build.js";

/**
 * `<om-grid-axis>` — renders the underlay grid, axis lines, and an
 * optional "extent rectangle" (OMEdit's white drawing area) into the
 * scene's `worldRoot`. Place it as a direct child of `<om-scene>`:
 *
 *     <om-scene>
 *       <om-grid-axis .coordinateSystem=${layout.coordinateSystem}></om-grid-axis>
 *       <!-- entities below -->
 *     </om-scene>
 *
 * When `coordinateSystem` is supplied the element drives its grid
 * spacing from `coordinateSystem.grid` (defaults to `[2, 2]` per the
 * Modelica spec — matches OMEdit) and renders a filled rectangle the
 * size of `coordinateSystem.extent` behind the lines.
 *
 * Direct `minor-step` / `major-step` / `extent` attributes still win
 * over the values derived from `coordinateSystem` so stories can
 * customise without manufacturing a full CS object.
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

  /**
   * Modelica `CoordinateSystem` whose `grid` + `extent` drive the
   * rendered grid spacing and the OMEdit-style "drawing area"
   * rectangle. When `undefined`, the element falls back to plain
   * defaults (no extent rectangle, default minor/major spacing).
   */
  @property({ attribute: false })
  coordinateSystem: CoordinateSystem | undefined = undefined;

  /** Half-extent of the grid lines (diagram units). */
  @property({ type: Number })
  extent = DEFAULT_GRID_OPTIONS.extent;

  /** Override the X minor step. Wins over `coordinateSystem.grid[0]`. */
  @property({ type: Number, attribute: "minor-step" })
  minorStep: number | undefined = undefined;

  /** Override the X major step. Wins over the auto-derived value. */
  @property({ type: Number, attribute: "major-step" })
  majorStep: number | undefined = undefined;

  /** When `false`, the extent rectangle is skipped even if `coordinateSystem.extent` is present. */
  @property({ type: Boolean, attribute: "show-extent-rect" })
  showExtentRect = true;

  /** Color of the extent-rect fill (default: white). Hex `#rrggbb`. */
  @property({ attribute: "extent-rect-color" })
  extentRectColor: string | undefined = undefined;

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
    this.meshes = buildGrid(ctx.scene, this.ownNode, this.computeOptions());
  }

  private computeOptions(): GridOptions {
    const cs = this.coordinateSystem;
    const csGrid = readGrid(cs);
    // Modelica's `grid` annotation is a SNAP step (typical default
    // `(2, 2)`), not a visible grid step — drawing a line at every
    // 2 units would render hundreds of lines across the canonical
    // [-100, 100] extent. Multiply by 10 to match OMEdit's actual
    // rendered grid density. Major lines fall every 5 minors.
    const minorX = this.minorStep ?? csGrid.x * 10;
    const minorY = csGrid.y * 10;
    const majorX = this.majorStep ?? minorX * 5;
    const majorY = this.majorStep ?? minorY * 5;

    const options: GridOptions = {
      extent: this.extent,
      minorStep: minorX,
      minorStepY: minorY,
      majorStep: majorX,
      majorStepY: majorY,
      minorColor: parseColor(this.minorColor) ?? DEFAULT_GRID_OPTIONS.minorColor,
      majorColor: parseColor(this.majorColor) ?? DEFAULT_GRID_OPTIONS.majorColor,
      axisColor: parseColor(this.axisColor) ?? DEFAULT_GRID_OPTIONS.axisColor,
    };

    if (this.showExtentRect) {
      const rect = readExtent(cs);
      if (rect) {
        options.extentRect = {
          ...rect,
          color: parseColor(this.extentRectColor) ?? undefined,
        };
      }
    }
    return options;
  }

  private disposeMeshes(): void {
    if (this.meshes) {
      this.meshes.minor.dispose(false, true);
      this.meshes.major.dispose(false, true);
      this.meshes.axes.dispose(false, true);
      this.meshes.extentRect?.dispose(false, true);
      this.meshes.extentRectMaterial?.dispose();
      this.meshes.extentBorder?.dispose(false, true);
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

/**
 * Pull `[gridX, gridY]` out of a Modelica `CoordinateSystem.grid`.
 * Modelica's default when the attribute is unset is `{2, 2}`; we use
 * that here so the rendered grid matches OMEdit's idle-state grid
 * step in the (very common) case where the source annotation omits
 * the field.
 */
function readGrid(cs: CoordinateSystem | undefined): { x: number; y: number } {
  const arr = cs?.grid;
  if (!Array.isArray(arr) || arr.length < 2) {
    return { x: 2, y: 2 };
  }
  const x = Number(arr[0]);
  const y = Number(arr[1]);
  return {
    x: Number.isFinite(x) && x > 0 ? x : 2,
    y: Number.isFinite(y) && y > 0 ? y : 2,
  };
}

function readExtent(
  cs: CoordinateSystem | undefined,
):
  | { x1: number; y1: number; x2: number; y2: number }
  | undefined {
  const ext = cs?.extent;
  if (!Array.isArray(ext) || ext.length < 2) {
    return undefined;
  }
  const a = ext[0];
  const b = ext[1];
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) {
    return undefined;
  }
  const x1 = Number(a[0]);
  const y1 = Number(a[1]);
  const x2 = Number(b[0]);
  const y2 = Number(b[1]);
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return undefined;
  }
  return { x1, y1, x2, y2 };
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
