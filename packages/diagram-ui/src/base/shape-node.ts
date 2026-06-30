import { Container, Graphics, Rectangle } from "pixi.js";

import { applyPlacement, type AppliedTransform } from "./placement-math.js";
import { buildHitTube } from "./hit-tube.js";
import {
  ResizeHandles,
  RotateHandle,
  SelectionOutline,
  VertexHandles,
} from "./selection-overlay.js";
import { tagEntity, type EntityKind } from "../interaction/node-keys.js";
import type { SceneContext } from "../scene/scene-context.js";
import type {
  CoordinateSystem,
  Extent,
  Placement,
  Point,
} from "@dicode/omc-client";

/** Hover band / hit-tube colour. */
const HIGHLIGHT_COLOR = 0x6199fa;

/** Pick tolerance (diagram units) of a poly shape's follow-the-line hit
 *  tube — matches the connection edge's `WAYPOINT_RADIUS`. */
const POLY_HIT_RADIUS = 1.5;

/** Opacity the hit tube reveals at while the poly is hovered — matches the
 *  connection edge's hover band. */
const HIT_HOVER_OPACITY = 0.3;

/** Entity kinds carried by a shape-node transform. Other tags (handles,
 *  ports, junctions) are produced elsewhere, so a name with one of those
 *  prefixes is not treated as the transform's own identity. */
const TRANSFORM_KINDS = new Set<EntityKind>([
  "component",
  "connector",
  "shape",
  "label",
]);

function isTransformKind(value: string): value is EntityKind {
  return (TRANSFORM_KINDS as ReadonlySet<string>).has(value);
}

/**
 * Which bounding-box selection handles an entity offers. Poly shapes
 * (line / polygon) opt out of both — their geometry is edited per-vertex,
 * not by a bounding box, so they show only the selection outline.
 */
export interface SelectionAffordances {
  resize: boolean;
  rotate: boolean;
}

/**
 * Renderer-side wrapper for one entity element. Owns:
 *
 *  - `transform` — the entity `Container` (anchored at the placement
 *    origin + extent centre in the parent's coord system; rotation
 *    pivots here). `sortableChildren` is on so child zIndex orders the
 *    icon, outline and handles.
 *  - `mesh` — a transparent "hit plane" `Graphics` sized to the icon
 *    extent. It's the picking + highlight target, so picks land on the
 *    full component box regardless of which individual shape was clicked.
 *  - The selection outline + resize / rotate handles (the latter gated by
 *    `setSelectionAffordances`, so poly shapes show outline only).
 *
 * Icon graphics themselves are NOT owned here — the parent
 * `OmShapeElement` renders one `<om-rectangle>` / `<om-text>` / … per
 * Modelica shape inside its template, and those primitive components
 * attach their `Graphics` to this `transform` via Lit context.
 */
export class OmShapeNode {
  readonly transform: Container;
  readonly mesh: Graphics;

  private currentIconWidth = 1;
  private currentIconHeight = 1;
  private currentIconCx = 0;
  private currentIconCy = 0;
  private selected = false;
  private affordResize = true;
  private affordRotate = true;
  private resizeHandles: ResizeHandles | null = null;
  private rotateHandle: RotateHandle | null = null;
  private outline: SelectionOutline | null = null;
  private vertices: Point[] | null = null;
  private vertexHandles: VertexHandles | null = null;
  private hitTube: Graphics | null = null;
  private hovered = false;

  constructor(
    private readonly ctx: SceneContext,
    parent: Container,
    name = "om-shape",
  ) {
    this.transform = new Container({ label: name });
    this.transform.sortableChildren = true;
    this.tagFromName(name);
    // The parent orders entities (and host-shape z-bands) by zIndex; without
    // sorting they would paint in insertion order and ignore `zOffset`.
    parent.sortableChildren = true;
    parent.addChild(this.transform);

    // Hit plane: a unit rect filled at alpha 0 — invisible but pickable,
    // scaled in `placeTransform` to cover the icon extent. The explicit
    // `hitArea` keeps it grabbable despite the zero-alpha fill.
    this.mesh = new Graphics({ label: `plane.${name}` });
    this.mesh.rect(-0.5, -0.5, 1, 1).fill({ color: 0x000000, alpha: 0 });
    this.mesh.hitArea = new Rectangle(-0.5, -0.5, 1, 1);
    this.mesh.eventMode = "static";
    this.transform.addChild(this.mesh);
  }

  /**
   * Rename the entity transform and re-tag its identity. The `name` is the
   * canonical `om-<kind>:<nodeId>` form; editable shapes call this when
   * their kind/index changes.
   */
  setEntityName(name: string): void {
    this.transform.label = name;
    this.mesh.label = `plane.${name}`;
    this.tagFromName(name);
  }

  /** Tag the transform's identity from its canonical `om-<kind>:<nodeId>`
   *  name. A name without a `:` (e.g. the bare `om-component` fallback)
   *  stays untagged, so the picker resolves the owner via an ancestor. */
  private tagFromName(name: string): void {
    if (!name.startsWith("om-")) {
      return;
    }
    const rest = name.slice(3);
    const colon = rest.indexOf(":");
    if (colon <= 0) {
      return;
    }
    const kind = rest.slice(0, colon);
    const nodeId = rest.slice(colon + 1);
    if (nodeId === "" || !isTransformKind(kind)) {
      return;
    }
    tagEntity(this.transform, kind, nodeId);
  }

  /**
   * Applies a placement (extent + optional origin + optional rotation in
   * degrees) and resizes the hit plane to the icon coordinate system.
   * Returns the resolved transform so callers (and tests) can read the
   * icon-local origin and size.
   */
  setPlacement(
    placement: Placement,
    iconCoordSystem: CoordinateSystem | undefined,
    zOffset: number = 0,
  ): AppliedTransform {
    const t = applyPlacement(placement, iconCoordSystem, zOffset);
    // The flip lives on the diagram root, so Modelica's CCW-positive degrees
    // map straight to Pixi `rotation` with no sign negation.
    this.transform.rotation = t.rotationZ;
    this.placeTransform(
      t.position.x,
      t.position.y,
      t.position.z,
      t.scale.x,
      t.scale.y,
      t.iconSize.width,
      t.iconSize.height,
      t.meshLocal.x,
      t.meshLocal.y,
    );
    return t;
  }

  /**
   * Positions the entity directly in the parent's coordinate space with no
   * icon scaling — for host shapes, whose geometry is already in diagram
   * coords. The transform sits at `origin` (unscaled, rotated about it), so
   * a child handle's local position is a diagram coordinate; the hit plane
   * + outline span `extent`. Used for poly shapes so per-vertex handles can
   * sit on the shape's `points` directly.
   */
  setDiagramBounds(
    extent: Extent,
    origin: Point | undefined,
    rotation: number,
    zOffset: number = 0,
  ): void {
    const w = Math.abs(extent[1][0] - extent[0][0]) || 1;
    const h = Math.abs(extent[1][1] - extent[0][1]) || 1;
    const cx = (extent[0][0] + extent[1][0]) / 2;
    const cy = (extent[0][1] + extent[1][1]) / 2;
    this.transform.rotation = (rotation * Math.PI) / 180;
    this.placeTransform(
      origin?.[0] ?? 0,
      origin?.[1] ?? 0,
      zOffset,
      1,
      1,
      w,
      h,
      cx,
      cy,
    );
  }

  private placeTransform(
    posX: number,
    posY: number,
    posZ: number,
    scaleX: number,
    scaleY: number,
    hitW: number,
    hitH: number,
    hitCx: number,
    hitCy: number,
  ): void {
    this.transform.position.set(posX, posY);
    // posZ follows the painter convention where more-negative is nearer the
    // viewer; zIndex is the opposite (higher draws in front), so negate.
    this.transform.zIndex = -posZ;
    this.transform.scale.set(scaleX, scaleY);

    const sizeChanged =
      this.currentIconWidth !== hitW || this.currentIconHeight !== hitH;
    const centreChanged =
      this.currentIconCx !== hitCx || this.currentIconCy !== hitCy;
    if (sizeChanged) {
      this.currentIconWidth = hitW;
      this.currentIconHeight = hitH;
      this.mesh.scale.set(hitW, hitH);
    }
    this.currentIconCx = hitCx;
    this.currentIconCy = hitCy;
    this.mesh.position.set(hitCx, hitCy);

    // Handles + outline trace the extent box, so they must follow its size
    // AND its centre. Rotation rebases the origin, which shifts the centre
    // with the size unchanged — the size-only guard missed that case.
    if (sizeChanged || centreChanged) {
      if (this.resizeHandles) {
        const wasVisible = this.resizeHandles.isVisible();
        this.resizeHandles.dispose();
        this.resizeHandles = this.createHandles();
        this.resizeHandles.setVisible(wasVisible);
      }
      if (this.rotateHandle) {
        const wasVisible = this.rotateHandle.isVisible();
        this.rotateHandle.dispose();
        this.rotateHandle = this.createRotateHandle();
        this.rotateHandle.setVisible(wasVisible);
      }
      this.outline?.resize(
        this.currentIconWidth,
        this.currentIconHeight,
        this.currentIconCx,
        this.currentIconCy,
      );
    }
    this.ctx.requestRender();
  }

  /**
   * Sets (or clears with `null`) a poly shape's points. They drive both the
   * per-vertex drag handles and a follow-the-line hit tube that replaces the
   * bounding-box hit plane — so a polyline is picked along its segments, not
   * across the whole bbox. Rebuilt live so a vertex edit reflects at once.
   */
  setPolyPoints(points: Point[] | null): void {
    // Layout points are referentially stable across rebuilds; an identity
    // match means no edit, so skip rebuilding the handles + tube.
    if (points === this.vertices) {
      return;
    }
    this.vertices = points;
    this.vertexHandles?.dispose();
    this.vertexHandles = null;
    this.hitTube?.destroy();
    this.hitTube = null;

    if (points && points.length >= 2) {
      // The bbox hit plane gives way to a tube tracing the segments; the
      // identity poly frame means a point is already a local coordinate.
      this.mesh.eventMode = "none";
      this.hitTube = buildHitTube(
        `hit.${this.transform.label}`,
        points,
        POLY_HIT_RADIUS,
        HIGHLIGHT_COLOR,
      );
      this.transform.addChild(this.hitTube);
    } else {
      this.mesh.eventMode = "static";
    }
    this.syncSelectionOverlay();
  }

  private createHandles(): ResizeHandles {
    return new ResizeHandles(
      this.ctx,
      this.transform,
      this.currentIconWidth,
      this.currentIconHeight,
      this.currentIconCx,
      this.currentIconCy,
    );
  }

  private createRotateHandle(): RotateHandle {
    return new RotateHandle(
      this.ctx,
      this.transform,
      this.currentIconWidth,
      this.currentIconHeight,
      this.currentIconCx,
      this.currentIconCy,
    );
  }

  setSelected(selected: boolean): void {
    if (this.selected === selected) {
      return;
    }
    this.selected = selected;
    this.syncSelectionOverlay();
  }

  /**
   * Hover state for a poly entity: reveals the follow-the-line hit tube as a
   * faint band and shows the vertex handles — the same affordance a
   * connection edge gives on hover.
   */
  setHovered(hovered: boolean): void {
    if (this.hovered === hovered) {
      return;
    }
    this.hovered = hovered;
    if (this.hitTube) {
      this.hitTube.alpha = hovered ? HIT_HOVER_OPACITY : 0;
      this.ctx.requestRender();
    }
    this.syncSelectionOverlay();
  }

  /**
   * Configures which bounding-box handles this entity offers. Applied live,
   * so toggling affordances on an already-selected entity hides the
   * now-disallowed handles. A poly shape passes `{resize:false,
   * rotate:false}` to show only the outline.
   */
  setSelectionAffordances(opts: SelectionAffordances): void {
    if (
      this.affordResize === opts.resize &&
      this.affordRotate === opts.rotate
    ) {
      return;
    }
    this.affordResize = opts.resize;
    this.affordRotate = opts.rotate;
    this.syncSelectionOverlay();
  }

  private syncSelectionOverlay(): void {
    const showResize = this.selected && this.affordResize;
    const showRotate = this.selected && this.affordRotate;
    // Poly shapes mark selection with their vertex dots; the bounding-box
    // outline would just be noise around the polyline.
    const showOutline = this.selected && this.vertices === null;

    if (showOutline && !this.outline) {
      this.outline = new SelectionOutline(
        this.ctx,
        this.transform,
        this.currentIconWidth,
        this.currentIconHeight,
        this.currentIconCx,
        this.currentIconCy,
        HIGHLIGHT_COLOR,
      );
    }
    this.outline?.setVisible(showOutline);

    if (showResize && !this.resizeHandles) {
      this.resizeHandles = this.createHandles();
    }
    this.resizeHandles?.setVisible(showResize);

    if (showRotate && !this.rotateHandle) {
      this.rotateHandle = this.createRotateHandle();
    }
    this.rotateHandle?.setVisible(showRotate);

    const showVertices =
      (this.selected || this.hovered) && this.vertices !== null;
    if (showVertices && !this.vertexHandles) {
      this.vertexHandles = new VertexHandles(
        this.ctx,
        this.transform,
        this.vertices ?? [],
        this.ownerId(),
      );
    }
    this.vertexHandles?.setVisible(showVertices);
  }

  /** The owning shape's id (`<shapeKind>:<index>`) for vertex keys, taken
   *  from the entity transform label (`om-shape:<shapeKind>:<index>`). A
   *  label without the `om-<kind>:` prefix yields `""`, which fails closed
   *  at the key parse rather than minting a bogus owner. */
  private ownerId(): string {
    const name = this.transform.label;
    const colon = name.indexOf(":");
    return colon < 0 ? "" : name.slice(colon + 1);
  }

  isSelected(): boolean {
    return this.selected;
  }

  /**
   * Resize the selection handles (corner resize + rotate) to a constant
   * screen-pixel size. Call when the zoom or canvas aspect changes. No-op
   * when handles are not currently visible.
   */
  rescaleSelectionHandles(): void {
    this.resizeHandles?.rescale();
    this.rotateHandle?.rescale();
    this.vertexHandles?.rescale();
  }

  dispose(): void {
    this.outline?.dispose();
    this.outline = null;
    this.resizeHandles?.dispose();
    this.resizeHandles = null;
    this.rotateHandle?.dispose();
    this.rotateHandle = null;
    this.vertexHandles?.dispose();
    this.vertexHandles = null;
    this.hitTube?.destroy();
    this.hitTube = null;
    this.transform.destroy({ children: true });
    this.ctx.requestRender();
  }
}
