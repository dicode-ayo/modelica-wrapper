import { LitElement, css, html } from "lit";
import { property } from "lit/decorators.js";
import { ContextConsumer, consume } from "@lit/context";
import type { Scene, TransformNode } from "@babylonjs/core";

import { parentNodeContext } from "../base/parent-node-context.js";
import { requestSceneRender } from "../scene/render-scheduler.js";
import {
  viewStateContext,
  type ViewStateStore,
} from "../scene/view-state-store.js";
import { zForOrder, type OwnedResource } from "./shape-utils.js";

/**
 * Base class for the six Modelica icon primitives (`<om-rectangle>`,
 * `<om-polygon>`, `<om-line>`, `<om-ellipse>`, `<om-text>`,
 * `<om-bitmap>`). Each one is a Lit element nested inside an
 * `<om-component>` / `<om-connector>` and consumes the entity's
 * `TransformNode` via Lit context — same plumbing as connectors.
 *
 * Subclasses declare their own shape-data property (each shape kind has
 * its own fields) and implement two hooks:
 *
 *   - `fingerprint()` — a structural cache key. The base class skips
 *     the dispose+rebuild when the shape content is unchanged, so an
 *     OMC roundtrip that produces a new reference with identical
 *     content doesn't re-create textures and flicker.
 *   - `buildMeshes(parent, z)` — creates the Babylon meshes and
 *     returns the disposables. Called only when the fingerprint
 *     changes (or on first update).
 */
export abstract class OmShapePrimitive extends LitElement {
  static override styles = css`
    :host {
      display: none;
    }
  `;

  /**
   * Draw order within the icon. The parent `<om-component>` numbers
   * shapes flat across layers; higher numbers paint on top (camera
   * sits at -Z, so we accumulate a small negative z per step).
   */
  @property({ type: Number, attribute: "z-order" })
  zOrder = 0;

  /**
   * Larger-scale z offset added to `zForOrder(zOrder)`. Used by host-
   * class shapes (rendered directly under `<om-scene>` as background)
   * to sit safely behind component icons — camera sits at -Z, so a
   * positive `zBias` pushes the mesh away from the camera. Default
   * `0` keeps shape-inside-component primitives in the component's
   * local plane.
   */
  @property({ type: Number, attribute: "z-bias" })
  zBias = 0;

  /**
   * Host's stroke-width multiplier (`lineThicknessScale`), forwarded by
   * `renderShape`. Folded into the rebuild key so a scale change
   * re-strokes the shape.
   */
  @property({ attribute: false })
  lineThicknessScale: number | undefined = undefined;

  @consume({ context: parentNodeContext, subscribe: true })
  protected parentTransform: TransformNode | null = null;

  protected resources: OwnedResource[] = [];
  private lastBuiltKey: string | null = null;

  /** Unsubscribe from the view-state store; rebound when the context
   *  resolves to a new store (mount, scene teardown, hot reload). */
  private viewUnsub: (() => void) | null = null;

  constructor() {
    super();
    // Dashed strokes hold a constant on-screen rhythm, so a zoom (which
    // changes world-per-pixel) has to recompute their dash count. Each
    // primitive subscribes to the scene's view-state store and rescales
    // its own resources — a no-op for solid strokes.
    new ContextConsumer(this, {
      context: viewStateContext,
      subscribe: true,
      callback: (store) => this.resubscribeViewState(store),
    });
  }

  private resubscribeViewState(store: ViewStateStore | null): void {
    this.viewUnsub?.();
    this.viewUnsub = store
      ? store.subscribe(() => this.rescaleResources())
      : null;
  }

  private rescaleResources(): void {
    let touched = false;
    for (const r of this.resources) {
      if (r.rescaleForView) {
        r.rescaleForView();
        touched = true;
      }
    }
    if (touched) {
      this.requestRender();
    }
  }

  override render() {
    return html``;
  }

  override updated(): void {
    const parent = this.parentTransform;
    if (!parent) {
      return;
    }
    const key = `${this.zOrder}|${this.zBias}|${this.lineThicknessScale}|${this.fingerprint()}`;
    if (key === this.lastBuiltKey) {
      return;
    }
    this.lastBuiltKey = key;
    this.tearDownMeshes();
    this.buildMeshes(parent, this.zBias + zForOrder(this.zOrder));
    this.requestRender();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.viewUnsub?.();
    this.viewUnsub = null;
    this.tearDownMeshes();
    this.lastBuiltKey = null;
  }

  protected scene(): Scene | null {
    return this.parentTransform?.getScene() ?? null;
  }

  protected requestRender(): void {
    const scene = this.scene();
    if (scene) {
      requestSceneRender(scene);
    }
  }

  protected tearDownMeshes(): void {
    if (this.resources.length === 0) {
      return;
    }
    for (const r of this.resources) {
      r.dispose();
    }
    this.resources = [];
  }

  /** Structural key for the shape's content. The base class skips
   *  rebuilds when this string doesn't change. */
  protected abstract fingerprint(): string;

  /** Build the Babylon meshes for the current shape data and push the
   *  disposables onto `this.resources`. Called with the entity's
   *  TransformNode and the z position derived from `zOrder`. */
  protected abstract buildMeshes(parent: TransformNode, z: number): void;
}
