import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Scene,
} from "@babylonjs/core";

import { applyPlacement, type AppliedTransform } from "./placement-math.js";
import { buildHitTube } from "./hit-tube.js";
import {
  ResizeHandles,
  RotateHandle,
  SelectionOutline,
  VertexHandles,
} from "./selection-overlay.js";
import { requestSceneRender } from "../scene/render-scheduler.js";
import type {
  CoordinateSystem,
  Extent,
  Placement,
  Point,
} from "@dicode/omc-client";

const HIGHLIGHT_COLOR = new Color3(0.38, 0.6, 0.98);

/** Pick tolerance (diagram units) of a poly shape's follow-the-line hit
 *  tube — matches the connection edge's `WAYPOINT_RADIUS`. */
const POLY_HIT_RADIUS = 1.5;

/** Opacity the hit tube reveals at while the poly is hovered — matches the
 *  connection edge's hover band. */
const HIT_HOVER_OPACITY = 0.3;

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
 * Babylon-side wrapper for one entity element. Owns:
 *
 *  - `transform` — the entity TransformNode (anchored at the placement
 *    origin + extent centre in the parent's coord system; rotation
 *    pivots here).
 *  - `mesh` — a transparent "hit plane" sized to the icon extent. It's
 *    the picking + highlight target, so picks land on the full
 *    component box and the selection outline traces the extent
 *    regardless of which individual shape was clicked.
 *  - The selection outline + resize / rotate handles (the latter gated
 *    by `setSelectionAffordances`, so poly shapes show outline only).
 *
 * Icon graphics themselves are NOT owned here — the parent
 * `OmShapeElement` renders one `<om-rectangle>` / `<om-text>` / …
 * per Modelica shape inside its template, and those primitive
 * components attach their meshes to this `transform` via Lit context.
 */
export class OmShapeNode {
  readonly transform: TransformNode;
  private readonly hitMaterial: StandardMaterial;
  readonly mesh: Mesh;

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
  private hitTube: Mesh | null = null;
  private hovered = false;
  private readonly scene: Scene;

  constructor(scene: Scene, parent: TransformNode, name = "om-shape") {
    this.scene = scene;
    this.transform = new TransformNode(name, scene);
    this.transform.parent = parent;

    // Hit plane: transparent, pickable, covers the icon extent. We
    // intentionally leave the material at alpha = 0 (rather than
    // `isVisible = false`) so the HighlightLayer's offscreen pass
    // still renders the silhouette and produces a selection outline
    // around the extent box.
    this.hitMaterial = new StandardMaterial(`${name}-hit-mat`, scene);
    this.hitMaterial.disableLighting = true;
    this.hitMaterial.alpha = 0;
    this.hitMaterial.specularColor = new Color3(0, 0, 0);
    this.hitMaterial.emissiveColor = new Color3(0, 0, 0);
    this.hitMaterial.backFaceCulling = false;

    // Mesh name uses a `plane.<owner>` prefix so it doesn't satisfy
    // `entityKeyForNode`'s `^om-(component|connector|label):` regex —
    // the walker resolves the owner via the parent TransformNode
    // (named `om-component:<id>` etc.) instead.
    this.mesh = MeshBuilder.CreatePlane(
      `plane.${name}`,
      { width: 1, height: 1, sideOrientation: Mesh.DOUBLESIDE },
      scene,
    );
    this.mesh.material = this.hitMaterial;
    this.mesh.parent = this.transform;
    this.mesh.isPickable = true;
  }

  /**
   * Applies a placement (extent + optional origin + optional rotation
   * in degrees) and resizes the hit plane to the icon coordinate
   * system. Returns the resolved transform so callers (and tests) can
   * read the icon-local origin and size.
   */
  setPlacement(
    placement: Placement,
    iconCoordSystem: CoordinateSystem | undefined,
    zOffset: number = 0,
  ): AppliedTransform {
    const t = applyPlacement(placement, iconCoordSystem, zOffset);
    this.transform.rotation.set(0, 0, t.rotationZ);
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
    this.transform.rotation.set(0, 0, (rotation * Math.PI) / 180);
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
    this.transform.position.set(posX, posY, posZ);
    this.transform.scaling.set(scaleX, scaleY, 1);

    const sizeChanged =
      this.currentIconWidth !== hitW || this.currentIconHeight !== hitH;
    if (sizeChanged) {
      this.currentIconWidth = hitW;
      this.currentIconHeight = hitH;
      this.mesh.scaling.set(hitW, hitH, 1);
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
    }
    this.currentIconCx = hitCx;
    this.currentIconCy = hitCy;
    this.mesh.position.set(hitCx, hitCy, 0);
    if (this.outline && sizeChanged) {
      this.outline.resize(
        this.currentIconWidth,
        this.currentIconHeight,
        this.currentIconCx,
        this.currentIconCy,
      );
    }
    requestSceneRender(this.scene);
  }

  /**
   * Sets (or clears with `null`) a poly shape's points. They drive both the
   * per-vertex drag handles and a follow-the-line hit tube that replaces the
   * bounding-box hit plane — so a polyline is picked along its segments, not
   * across the whole bbox. Rebuilt live so a vertex edit reflects at once.
   */
  setPolyPoints(points: Point[] | null): void {
    // The layout is immutable, so an unchanged shape hands back the same
    // `points` reference — only rebuild on a real edit.
    if (points === this.vertices) {
      return;
    }
    this.vertices = points;
    this.vertexHandles?.dispose();
    this.vertexHandles = null;
    this.hitTube?.dispose();
    this.hitTube = null;

    if (points && points.length >= 2) {
      // The bbox hit plane gives way to a tube tracing the segments; the
      // identity poly frame means a point is already a local coordinate.
      this.mesh.isPickable = false;
      this.hitTube = buildHitTube(
        this.scene,
        `hit.${this.transform.name}`,
        points.map(([x, y]) => new Vector3(x, y, -0.01)),
        POLY_HIT_RADIUS,
        HIGHLIGHT_COLOR,
      );
      this.hitTube.parent = this.transform;
    } else {
      this.mesh.isPickable = true;
    }
    this.syncSelectionOverlay();
  }

  private createHandles(): ResizeHandles {
    return new ResizeHandles(
      this.scene,
      this.transform,
      this.currentIconWidth,
      this.currentIconHeight,
      this.currentIconCx,
      this.currentIconCy,
    );
  }

  private createRotateHandle(): RotateHandle {
    return new RotateHandle(
      this.scene,
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
      this.hitTube.visibility = hovered ? HIT_HOVER_OPACITY : 0;
    }
    this.syncSelectionOverlay();
  }

  /**
   * Configures which bounding-box handles this entity offers. Applied
   * live, so toggling affordances on an already-selected entity hides the
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
        this.scene,
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
        this.scene,
        this.transform,
        this.vertices ?? [],
      );
    }
    this.vertexHandles?.setVisible(showVertices);
  }

  isSelected(): boolean {
    return this.selected;
  }

  /**
   * Resize the selection handles (corner resize + rotate) to a constant
   * screen-pixel size. Call when the camera's zoom or canvas aspect
   * changes. No-op when handles are not currently visible.
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
    this.hitTube?.dispose();
    this.hitTube = null;
    this.mesh.dispose();
    this.hitMaterial.dispose();
    this.transform.dispose();
  }
}
