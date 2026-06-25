import { LitElement, css, html } from "lit";
import { property } from "lit/decorators.js";
import { consume } from "@lit/context";
import type { Scene, TransformNode } from "@babylonjs/core";

import type { Extent, Point } from "@dicode/omc-client";

import { parentNodeContext } from "../base/parent-node-context.js";
import { OmShapeNode } from "../base/shape-node.js";
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
   * When `true`, the primitive is a first-class editable entity: it owns an
   * `OmShapeNode` (a named transform + pickable hit geometry + selection
   * overlay / vertex handles), and draws its visual under that node. When
   * `false` (the default — every icon primitive), it's pure paint drawn
   * under the parent transform with no interaction.
   */
  @property({ type: Boolean }) editable = false;

  /** Selection flag, honoured only when `editable`. */
  @property({ type: Boolean }) selected = false;

  /** Position in the host's own-layer shape array — the `shape:` key index,
   *  used to name the entity when `editable`. */
  @property({ type: Number }) entityIndex = 0;

  @consume({ context: parentNodeContext, subscribe: true })
  protected parentTransform: TransformNode | null = null;

  protected resources: OwnedResource[] = [];
  private lastBuiltKey: string | null = null;
  private shapeNode: OmShapeNode | null = null;

  override render() {
    return html``;
  }

  override updated(): void {
    const parent = this.parentTransform;
    if (!parent) {
      return;
    }
    if (this.editable) {
      this.updateEditable(parent);
      return;
    }
    const key = `${this.zOrder}|${this.zBias}|${this.fingerprint()}`;
    if (key === this.lastBuiltKey) {
      return;
    }
    this.lastBuiltKey = key;
    this.tearDownMeshes();
    this.buildMeshes(parent, this.zBias + zForOrder(this.zOrder));
    this.requestRender();
  }

  /**
   * Editable path: maintain an `OmShapeNode` under `parent` and draw the
   * visual under it, so the same shape that renders in an icon becomes a
   * selectable, hit-testable, vertex-editable entity on the host canvas.
   */
  private updateEditable(parent: TransformNode): void {
    if (!this.shapeNode) {
      this.shapeNode = new OmShapeNode(
        parent.getScene(),
        parent,
        this.entityName(),
      );
    }
    const node = this.shapeNode;
    node.transform.name = this.entityName();
    const key = `${this.zBias}|${this.fingerprint()}`;
    if (key !== this.lastBuiltKey) {
      this.lastBuiltKey = key;
      this.tearDownMeshes();
      const b = this.entityBounds();
      if (b) {
        node.setDiagramBounds(b.extent, b.origin, b.rotation ?? 0, this.zBias);
        node.setPolyPoints(b.points ?? null);
        // A poly is edited per-vertex — no bounding-box resize/rotate.
        const poly = b.points !== undefined;
        node.setSelectionAffordances({ resize: !poly, rotate: !poly });
      }
      // Draw the visual under the entity's (unscaled) transform.
      this.buildMeshes(node.transform, zForOrder(this.zOrder));
    }
    node.setSelected(this.selected);
    this.requestRender();
  }

  private entityName(): string {
    return `om-shape:${this.entityKind()}:${this.entityIndex}`;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.tearDownMeshes();
    this.shapeNode?.dispose();
    this.shapeNode = null;
    this.lastBuiltKey = null;
  }

  /** The `shape:` key kind for the entity name. Overridden by primitives
   *  that support `editable` (line / polygon / …). */
  protected entityKind(): string {
    return "";
  }

  /**
   * The entity's frame: bounding `extent` (+ optional `origin` / `rotation`)
   * and, for a poly, its `points` (drives the hit tube + vertex handles).
   * `null` leaves the entity unsized. Overridden by editable primitives.
   */
  protected entityBounds(): {
    extent: Extent;
    origin?: Point | undefined;
    rotation?: number | undefined;
    points?: Point[] | undefined;
  } | null {
    return null;
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
