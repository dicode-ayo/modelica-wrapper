import { LitElement, css, html } from "lit";
import { property } from "lit/decorators.js";
import { consume } from "@lit/context";
import type { Scene, TransformNode } from "@babylonjs/core";

import { parentNodeContext } from "../base/parent-node-context.js";
import { requestSceneRender } from "../scene/render-scheduler.js";
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

  @consume({ context: parentNodeContext, subscribe: true })
  protected parentTransform: TransformNode | null = null;

  protected resources: OwnedResource[] = [];
  private lastBuiltKey: string | null = null;

  override render() {
    return html``;
  }

  override updated(): void {
    const parent = this.parentTransform;
    if (!parent) {
      return;
    }
    const key = `${this.zOrder}|${this.fingerprint()}`;
    if (key === this.lastBuiltKey) {
      return;
    }
    this.lastBuiltKey = key;
    this.tearDownMeshes();
    this.buildMeshes(parent, zForOrder(this.zOrder));
    this.requestRender();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
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
