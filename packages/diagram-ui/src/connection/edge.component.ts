import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { Container } from "pixi.js";
import type { Point } from "@dicode/omc-client";

import { parentNodeContext } from "../base/parent-node-context.js";
import { sceneContext, type SceneContext } from "../scene/scene-context.js";
import { watchViewState } from "../scene/view-state-store.js";
import { tagEntity } from "../interaction/node-keys.js";
import { pointsEqual } from "../interaction/connection-route.js";
import {
  DEFAULT_EDGE_COLOR,
  HIT_HOVER_OPACITY,
  buildEdge,
  rebuildHitTube,
  updateEdgePoints,
  type EdgeMeshes,
} from "./edge-build.js";

/** Highlight colour applied to the visible line when the edge is selected. */
const SELECTED_EDGE_COLOR = 0x3d82f5; // blue-500

/**
 * `<om-edge>` — renders a single connection route as a crisp 1-pixel
 * `Graphics` polyline (dashed when `clocked`), plus an invisible
 * follow-the-line hit band so `pick` can land on the thin stroke.
 *
 * Properties:
 *   - `path`     — diagram-coord waypoints (>=2 points)
 *   - `stroke`   — CSS-style `#rrggbb` colour, optional
 *   - `clocked`  — dashed pattern for synchronous-clock connections
 *   - `selected` — switches the visible line to the selection colour
 *   - `hovered`  — reveals the pick band as a translucent hover ribbon
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
  @property({ type: Boolean }) hovered = false;

  @consume({ context: parentNodeContext, subscribe: true })
  private parentTransform: Container | null = null;

  @consume({ context: sceneContext, subscribe: true })
  private sceneCtx: SceneContext | null = null;

  private meshes: EdgeMeshes | null = null;
  private baseColor: number = DEFAULT_EDGE_COLOR;
  /** Selection state the line is currently drawn against; `null` forces a
   *  re-stroke after a (re)build. */
  private appliedSelected: boolean | null = null;
  /**
   * Last waypoint list the line was drawn against. Compared by content
   * (not reference) so an OMC-roundtripped layout producing a fresh-but-
   * equal `path` is a no-op — see `pointsEqual`.
   */
  private builtPath: Point[] | null = null;
  /** `worldPerPixel` the line was last drawn against, so a pure pan (no
   *  zoom change) is a no-op rather than a needless re-stroke. */
  private lastDashWpp: number | undefined = undefined;
  private readonly viewWatch: { dispose: () => void };

  constructor() {
    super();
    this.viewWatch = watchViewState(this, () => this.onViewChange());
  }

  /** A `clocked` dash rhythm is screen-constant, so a zoom change must
   *  re-stroke it even though `path` didn't change — but a pure pan
   *  (worldPerPixel unchanged) shouldn't. */
  private onViewChange(): void {
    if (!this.clocked || !this.meshes) {
      return;
    }
    const wpp = this.sceneCtx?.worldPerPixel();
    if (wpp === this.lastDashWpp) {
      return;
    }
    this.lastDashWpp = wpp;
    updateEdgePoints(
      this.meshes.line,
      this.path,
      this.effectiveColor(),
      this.clocked,
      wpp,
    );
    this.sceneCtx?.requestRender();
  }

  override render() {
    return html``;
  }

  override updated(changed: Map<string, unknown>): void {
    // Visual-option changes recreate the geometry; path-only changes redraw
    // in place so a component drag doesn't churn the scene graph. Selection
    // is a colour re-stroke on the existing line, never a rebuild.
    const visualChanged =
      changed.has("stroke") || changed.has("clocked") || changed.has("nodeId");
    const pathChanged =
      changed.has("path") && !pointsEqual(this.path, this.builtPath);
    if (!this.meshes || visualChanged) {
      this.rebuild();
    } else if (pathChanged) {
      // A path that shrank below two points can't be drawn; tear the edge
      // down rather than redrawing in place and leaving a stale stroke.
      if (this.path.length < 2) {
        this.disposeMeshes();
        this.sceneCtx?.requestRender();
      } else {
        this.redrawInPlace();
      }
    }
    this.applySelection();
    this.applyHover();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.viewWatch.dispose();
    this.disposeMeshes();
  }

  private edgeName(): string {
    return `om-edge:${this.nodeId || "anon"}`;
  }

  private effectiveColor(): number {
    return this.selected ? SELECTED_EDGE_COLOR : this.baseColor;
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
    this.baseColor = parseColor(this.stroke) ?? DEFAULT_EDGE_COLOR;
    const name = this.edgeName();
    const wpp = this.sceneCtx?.worldPerPixel();
    this.meshes = buildEdge(this.parentTransform, name, {
      points: this.path,
      clocked: this.clocked,
      color: this.effectiveColor(),
      ...(wpp !== undefined ? { worldPerPixel: wpp } : {}),
    });
    if (this.meshes) {
      tagEntity(this.meshes.line, "edge", this.nodeId);
      tagEntity(this.meshes.hitArea, "edge", this.nodeId);
    }
    this.builtPath = this.path;
    this.appliedSelected = this.selected;
    this.lastDashWpp = wpp;
    this.sceneCtx?.requestRender();
  }

  /**
   * Redraw the existing line against the new path and swap in a fresh hit
   * band (its `hitArea` is recomputed from the points). The visible line
   * keeps its identity tag; the band is re-tagged after the swap, so no
   * manual metadata copy is needed.
   */
  private redrawInPlace(): void {
    if (!this.meshes || !this.parentTransform) {
      return;
    }
    const wpp = this.sceneCtx?.worldPerPixel();
    updateEdgePoints(
      this.meshes.line,
      this.path,
      this.effectiveColor(),
      this.clocked,
      wpp,
    );
    this.meshes.hitArea.destroy();
    const hit = rebuildHitTube(
      this.parentTransform,
      `${this.edgeName()}.hit`,
      this.path,
    );
    tagEntity(hit, "edge", this.nodeId);
    this.meshes.hitArea = hit;
    this.builtPath = this.path;
    this.appliedSelected = this.selected;
    this.lastDashWpp = wpp;
    this.sceneCtx?.requestRender();
  }

  private applySelection(): void {
    if (!this.meshes || this.appliedSelected === this.selected) {
      return;
    }
    const wpp = this.sceneCtx?.worldPerPixel();
    updateEdgePoints(
      this.meshes.line,
      this.path,
      this.effectiveColor(),
      this.clocked,
      wpp,
    );
    this.appliedSelected = this.selected;
    this.lastDashWpp = wpp;
    this.sceneCtx?.requestRender();
  }

  private applyHover(): void {
    if (!this.meshes) {
      return;
    }
    const alpha = this.hovered ? HIT_HOVER_OPACITY : 0;
    if (this.meshes.hitArea.alpha === alpha) {
      return;
    }
    this.meshes.hitArea.alpha = alpha;
    this.sceneCtx?.requestRender();
  }

  private disposeMeshes(): void {
    if (!this.meshes) {
      return;
    }
    this.meshes.line.destroy();
    this.meshes.hitArea.destroy();
    this.meshes = null;
    this.builtPath = null;
    this.appliedSelected = null;
    this.lastDashWpp = undefined;
  }

  /** Test accessors. */
  get edgeMesh(): EdgeMeshes | null {
    return this.meshes;
  }
}

function parseColor(input: string | undefined): number | undefined {
  if (!input) {
    return undefined;
  }
  const hex = input.match(/^#?([0-9a-fA-F]{6})$/)?.[1];
  if (hex === undefined) {
    return undefined;
  }
  return parseInt(hex, 16);
}

declare global {
  interface HTMLElementTagNameMap {
    "om-edge": OmEdge;
  }
}
