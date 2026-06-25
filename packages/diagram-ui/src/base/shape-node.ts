import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  type Scene,
} from "@babylonjs/core";

import { applyPlacement, type AppliedTransform } from "./placement-math.js";
import {
  ResizeHandles,
  RotateHandle,
  SelectionOutline,
} from "./selection-overlay.js";
import { requestSceneRender } from "../scene/render-scheduler.js";
import type { CoordinateSystem, Placement } from "@dicode/omc-client";

const HIGHLIGHT_COLOR = new Color3(0.38, 0.6, 0.98);

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
    this.transform.position.set(t.position.x, t.position.y, t.position.z);
    this.transform.scaling.set(t.scale.x, t.scale.y, t.scale.z);
    this.transform.rotation.set(0, 0, t.rotationZ);

    const sizeChanged =
      this.currentIconWidth !== t.iconSize.width ||
      this.currentIconHeight !== t.iconSize.height;
    if (sizeChanged) {
      this.currentIconWidth = t.iconSize.width;
      this.currentIconHeight = t.iconSize.height;
      this.mesh.scaling.set(t.iconSize.width, t.iconSize.height, 1);
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
    this.currentIconCx = t.meshLocal.x;
    this.currentIconCy = t.meshLocal.y;
    this.mesh.position.set(t.meshLocal.x, t.meshLocal.y, 0);
    if (this.outline && sizeChanged) {
      this.outline.resize(
        this.currentIconWidth,
        this.currentIconHeight,
        this.currentIconCx,
        this.currentIconCy,
      );
    }
    requestSceneRender(this.scene);
    return t;
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

    if (this.selected && !this.outline) {
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
    this.outline?.setVisible(this.selected);

    if (showResize && !this.resizeHandles) {
      this.resizeHandles = this.createHandles();
    }
    this.resizeHandles?.setVisible(showResize);

    if (showRotate && !this.rotateHandle) {
      this.rotateHandle = this.createRotateHandle();
    }
    this.rotateHandle?.setVisible(showRotate);
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
  }

  dispose(): void {
    this.outline?.dispose();
    this.outline = null;
    this.resizeHandles?.dispose();
    this.resizeHandles = null;
    this.rotateHandle?.dispose();
    this.rotateHandle = null;
    this.mesh.dispose();
    this.hitMaterial.dispose();
    this.transform.dispose();
  }
}
