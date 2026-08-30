import { LitElement, css, html } from "lit";
import { property } from "lit/decorators.js";
import { ContextConsumer, consume } from "@lit/context";
import type { Container, Renderer } from "pixi.js";

import type { Extent, Point } from "@dicode/omc-client";

import { parentNodeContext } from "../base/parent-node-context.js";
import { lineThicknessScaleContext } from "./stroke-scale-context.js";
import { OmShapeNode } from "../base/shape-node.js";
import {
  interactionStateContext,
  type InteractionStateStore,
} from "../interaction/interaction-state.js";
import { sceneContext, type SceneContext } from "../scene/scene-context.js";
import { watchViewState } from "../scene/view-state-store.js";
import {
  dashRunsFor,
  graphicItemNode,
  strokeFloorClamps,
  worldScaleOf,
  zForOrder,
  type GraphicItemTransform,
  type OwnedResource,
} from "./shape-utils.js";

/**
 * The frame an editable primitive places its entity in: the bounding
 * `extent` (+ optional `origin` / `rotation`), and for a poly its `points`
 * (which drive the hit tube + vertex handles).
 */
export interface EntityBounds {
  extent: Extent;
  origin?: Point | undefined;
  rotation?: number | undefined;
  points?: Point[] | undefined;
}

/** Entity frame for an extent-based shape (rectangle / ellipse / text /
 *  bitmap): its own `extent`, positioned + rotated about `origin`. */
export function extentEntityBounds(shape: {
  extent: Extent;
  origin?: Point | undefined;
  rotation?: number | undefined;
}): EntityBounds {
  return {
    extent: shape.extent,
    origin: shape.origin,
    rotation: shape.rotation,
  };
}

/**
 * Base class for the six Modelica shape primitives (`<om-rectangle>`,
 * `<om-polygon>`, `<om-line>`, `<om-ellipse>`, `<om-text>`, `<om-bitmap>`).
 * Each is a Lit element that consumes a parent `Container` via Lit context.
 * Subclasses declare their own shape-data property and implement:
 *
 *   - `fingerprint()` — a structural cache key; the base skips the
 *     dispose+rebuild when the shape content is unchanged.
 *   - `buildMeshes(parent, z, inEntityFrame)` — builds the Pixi
 *     `Graphics` / `Sprite` / `Text`.
 *   - `entityKind()` / `entityBounds()` — only needed to support `editable`
 *     (the shape's `shape:` kind and its entity frame).
 *
 * With `editable` off it's pure icon paint nested in an `<om-component>`;
 * with `editable` on it's a standalone selectable host-diagram entity.
 */
export abstract class OmShapePrimitive extends LitElement {
  static override styles = css`
    :host {
      display: none;
    }
  `;

  /**
   * Draw order within the icon. The parent `<om-component>` numbers
   * shapes flat across layers; higher numbers paint on top via a
   * larger zIndex.
   */
  @property({ type: Number, attribute: "z-order" })
  zOrder = 0;

  /**
   * Scene-z bias subtracted from `zForOrder(zOrder)` — positive pushes the
   * shape behind. Host-class shapes (rendered directly under `<om-scene>`)
   * pass `HOST_SHAPE_Z_BIAS` so they sit behind component icons. Default
   * `0` keeps shape-inside-component primitives in the component's local
   * band.
   */
  @property({ type: Number, attribute: "z-bias" })
  zBias = 0;

  /**
   * When `true`, the primitive is a first-class editable entity: it owns an
   * `OmShapeNode` (a named transform + pickable hit geometry + selection
   * overlay / vertex handles), and draws its visual under that node. When
   * `false` (the default — every icon primitive), it's pure paint drawn
   * under the parent container with no interaction.
   */
  @property({ type: Boolean }) editable = false;

  /**
   * Whether to reveal the hit tube and vertex handles on hover. Off for an
   * entity that may be selected but not edited — a read-only class's own
   * graphics, which are copyable but not movable.
   */
  @property({ type: Boolean }) editHandles = true;

  /** Selection flag, honoured only when `editable`. */
  @property({ type: Boolean }) selected = false;

  /** Position in the host's own-layer shape array — the `shape:` key index,
   *  used to name the entity when `editable`. */
  @property({ type: Number }) entityIndex = 0;

  @consume({ context: parentNodeContext, subscribe: true })
  protected parentTransform: Container | null = null;

  @consume({ context: sceneContext, subscribe: true })
  protected sceneCtx: SceneContext | null = null;

  @consume({ context: lineThicknessScaleContext, subscribe: true })
  protected lineThicknessScale: number | undefined = undefined;

  protected resources: OwnedResource[] = [];
  private lastBuiltKey: string | null = null;
  private shapeNode: OmShapeNode | null = null;
  private hovered = false;
  private interactionUnsub: (() => void) | null = null;
  private readonly viewWatch: { dispose: () => void };

  constructor() {
    super();
    // Registered for every primitive (the controller handles connect /
    // reconnect), but only an `editable` one subscribes to the store — icon
    // paint never reacts to hover. The context value is the store reference,
    // so this fires once per (re)connect, not per pointer move.
    new ContextConsumer(this, {
      context: interactionStateContext,
      subscribe: true,
      callback: (store) => this.onInteractionStore(store),
    });
    this.viewWatch = watchViewState(this, () => this.onViewChange());
  }

  /**
   * The shape's Modelica line pattern, for primitives with a dashable
   * stroke (line / polygon / rectangle / ellipse). `undefined` (the
   * default) means this primitive never needs a dash-zoom rebuild.
   */
  protected dashPattern(): string | undefined {
    return undefined;
  }

  /**
   * The Modelica thickness feeding this primitive's stroke, or `null` when
   * it draws none (text / bitmap, or a `"None"` line pattern with nothing
   * else riding the stroke width). Lets the build key track
   * `worldPerPixel` while the screen-space width floor clamps the stroke,
   * so the width re-resolves on zoom (`thickness: undefined` means the
   * spec default).
   */
  protected strokeThickness(): { thickness: number | undefined } | null {
    return null;
  }

  /**
   * React to pan/zoom. The default re-runs `updated()` (via
   * `requestUpdate()`) only when the primitive has zoom-coupled stroke
   * state — a dashed pattern, or a stroke the screen-space width floor may
   * clamp — and its build key folds in `worldPerPixel` below, so the key
   * comparison itself makes a pure pan (worldPerPixel unchanged) a cheap
   * no-op rather than a rebuild. Override for state outside the key
   * mechanism entirely, e.g. `<om-text>`'s zoom-dependent resolution.
   */
  protected onViewChange(): void {
    if (dashRunsFor(this.dashPattern()) || this.strokeThickness() !== null) {
      this.requestUpdate();
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
    if (this.editable) {
      this.updateEditable(parent);
      return;
    }
    // The parent's world scale feeds the stroke's scale-compensated width
    // (`buildStroke`), so a placement/resize change must rebuild even though
    // the shape data is unchanged.
    const key = `${this.zOrder}|${this.zBias}|${worldScaleOf(parent)}|${this.lineThicknessScale}|${this.strokeZoomKey()}|${this.fingerprint()}`;
    if (key === this.lastBuiltKey) {
      return;
    }
    this.lastBuiltKey = key;
    this.tearDownMeshes();
    this.buildMeshes(parent, this.paintZIndex());
    this.requestRender();
  }

  /**
   * Editable path: maintain an `OmShapeNode` under `parent` and draw the
   * visual under it, so the same shape that renders in an icon becomes a
   * selectable, hit-testable, vertex-editable entity on the host canvas.
   */
  private updateEditable(parent: Container): void {
    const ctx = this.sceneCtx;
    if (!ctx) {
      return;
    }
    if (!this.shapeNode) {
      this.shapeNode = new OmShapeNode(ctx, parent, this.entityName());
    }
    const node = this.shapeNode;
    node.setEntityName(this.entityName());
    node.setHovered(this.hovered);
    const key = `${this.zOrder}|${this.zBias}|${this.lineThicknessScale}|${this.strokeZoomKey()}|${this.fingerprint()}`;
    if (key !== this.lastBuiltKey) {
      this.lastBuiltKey = key;
      this.tearDownMeshes();
      const b = this.entityBounds();
      if (b) {
        node.setDiagramBounds(
          b.extent,
          b.origin,
          b.rotation ?? 0,
          -this.paintZIndex(),
        );
        node.setPolyPoints(b.points ?? null);
        const poly = b.points !== undefined;
        // A poly is edited per-vertex — no bounding-box resize/rotate. A
        // read-only entity offers none of the three; it stays pickable and
        // shows its outline.
        node.setSelectionAffordances({
          resize: !poly && this.editHandles,
          rotate: !poly && this.editHandles,
          vertices: this.editHandles,
        });
      }
      // The entity transform carries the shape's origin + rotation
      // (setDiagramBounds), so the visual draws raw geometry in this frame.
      this.buildMeshes(node.transform, zForOrder(this.zOrder), true);
    }
    node.setSelected(this.selected);
    this.requestRender();
  }

  /** The Pixi `zIndex` this shape paints at: draw order folded into the
   *  z-bias band. Both primitive paths derive from this — the editable path
   *  negates it into `setDiagramBounds`' scene-z `zOffset`, which
   *  `placeTransform` negates back. */
  private paintZIndex(): number {
    return zForOrder(this.zOrder) - this.zBias;
  }

  /** The build key's zoom term: `worldPerPixel`, but only while the stroke
   *  actually depends on zoom — a dashed pattern, or a width the
   *  screen-space floor clamps. A thick solid shape's key stays
   *  zoom-independent so panning and zooming never rebuild it. */
  private strokeZoomKey(): string {
    const wpp = this.sceneCtx?.worldPerPixel();
    const st = this.strokeThickness();
    const zoomBound =
      dashRunsFor(this.dashPattern()) !== null ||
      (st !== null &&
        strokeFloorClamps(st.thickness, this.lineThicknessScale, wpp));
    return zoomBound ? String(wpp) : "";
  }

  private entityName(): string {
    return `om-shape:${this.entityKind()}:${this.entityIndex}`;
  }

  /** This entity's `shape:` selection key — what the hover key matches. */
  private entityKey(): string {
    return `shape:${this.entityKind()}:${this.entityIndex}`;
  }

  /**
   * Attach to the host's interaction store so a pointer hover over this shape
   * reveals its hit tube + vertex handles, like a connection edge. Only
   * editable primitives subscribe; the hover is self-managed (not a
   * host-driven prop) so it doesn't re-render the whole layout.
   */
  private onInteractionStore(store: InteractionStateStore | null): void {
    this.interactionUnsub?.();
    this.interactionUnsub =
      this.editable && this.editHandles && store
        ? store.subscribe((snap) => this.onHover(snap.hoverKey))
        : null;
  }

  private onHover(hoverKey: string | null): void {
    const hovered = hoverKey === this.entityKey();
    if (hovered === this.hovered) {
      return;
    }
    this.hovered = hovered;
    this.shapeNode?.setHovered(hovered);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.interactionUnsub?.();
    this.interactionUnsub = null;
    this.viewWatch.dispose();
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
  protected entityBounds(): EntityBounds | null {
    return null;
  }

  /** The renderer this primitive draws into, or `null` headless. */
  protected renderer(): Renderer | null {
    return this.sceneCtx?.renderer ?? null;
  }

  protected requestRender(): void {
    this.sceneCtx?.requestRender();
  }

  /**
   * The container a primitive draws its geometry under. Off the editable
   * path it's a `graphicItemNode` carrying the shape's origin/rotation; in
   * the entity frame the parent already carries those, so it's the parent
   * itself (applying them again would place the shape twice).
   *
   * `z` is the shape's draw-order band. When a `graphicItemNode` wrapper is
   * created its fill/stroke are nested a level deeper than a sibling shape that
   * attaches straight to `parent`, and `zIndex` only sorts among siblings — so
   * the wrapper carries `z` to keep inter-shape order correct regardless of the
   * order Lit runs the sibling primitives. `sortableChildren` lets stroke draw
   * above fill within the root.
   */
  protected graphicRoot(
    parent: Container,
    shape: GraphicItemTransform,
    name: string,
    inEntityFrame: boolean,
    z: number,
  ): Container {
    if (inEntityFrame) {
      parent.sortableChildren = true;
      return parent;
    }
    const gi = graphicItemNode(parent, shape, name);
    this.resources.push(gi);
    if (gi.node !== parent) {
      gi.node.zIndex = z;
    }
    gi.node.sortableChildren = true;
    return gi.node;
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

  /**
   * Build the Pixi graphics for the current shape data and push the
   * disposables onto `this.resources`. `inEntityFrame` is `true` on the
   * editable path, where `parent` already carries the shape's
   * origin/rotation — the primitive must then draw raw geometry without its
   * own `graphicItemNode`, or the placement applies twice.
   */
  protected abstract buildMeshes(
    parent: Container,
    z: number,
    inEntityFrame?: boolean,
  ): void;
}
