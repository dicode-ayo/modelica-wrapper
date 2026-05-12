import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  type Scene,
} from "@babylonjs/core";

import { applyPlacement, type AppliedTransform } from "./placement-math.js";
import { ResizeHandles, setMeshHighlight } from "./selection-overlay.js";
import { requestSceneRender } from "../scene/render-scheduler.js";
import {
  buildShapeMeshes,
  type ShapeGroup,
} from "./shape-builder.js";
import type {
  CoordinateSystem,
  IconLayer,
  Placement,
} from "@modelica-wrapper/omc-client";

const HIGHLIGHT_COLOR = new Color3(0.38, 0.6, 0.98);

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
 *  - `shapeGroup` — the native Babylon meshes built from `IconLayer[]`
 *    (replaces the SVG-rasterised texture approach). Rebuilt whenever
 *    `setLayers()` is called with a new layer set.
 *
 * Children of `transform` see the icon's local coord system, so
 * `<om-connector>` and friends still attach in icon coords as before.
 */
export class OmShapeNode {
  readonly transform: TransformNode;
  private readonly hitMaterial: StandardMaterial;
  readonly mesh: Mesh;

  private currentIconWidth = 1;
  private currentIconHeight = 1;
  private currentIconCx = 0;
  private currentIconCy = 0;
  private shapeGroup: ShapeGroup | null = null;
  private selected = false;
  private resizeHandles: ResizeHandles | null = null;
  private readonly scene: Scene;
  private readonly baseName: string;

  constructor(scene: Scene, parent: TransformNode, name = "om-shape") {
    this.scene = scene;
    this.baseName = name;
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
    }
    this.currentIconCx = t.meshLocal.x;
    this.currentIconCy = t.meshLocal.y;
    this.mesh.position.set(t.meshLocal.x, t.meshLocal.y, 0);
    requestSceneRender(this.scene);
    return t;
  }

  /**
   * Rebuild the shape meshes from the supplied layer list. Replaces
   * the previous group entirely — no diffing — because icon updates
   * are rare and the simple path is easier to keep correct.
   */
  setLayers(
    layers: ReadonlyArray<IconLayer>,
    coordinateSystem: CoordinateSystem | undefined,
  ): void {
    this.shapeGroup?.dispose();
    if (layers.length === 0) {
      this.shapeGroup = null;
      return;
    }
    this.shapeGroup = buildShapeMeshes(
      this.scene,
      this.transform,
      layers,
      coordinateSystem,
      this.baseName,
    );
    requestSceneRender(this.scene);
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

  setSelected(selected: boolean): void {
    if (this.selected === selected) {
      return;
    }
    this.selected = selected;

    // Highlight outline (no-op under NullEngine). `setMeshHighlight`
    // creates the HighlightLayer lazily on the first add and disposes
    // it when the last mesh is removed.
    setMeshHighlight(this.scene, this.mesh, selected ? HIGHLIGHT_COLOR : null);

    if (selected) {
      if (!this.resizeHandles) {
        this.resizeHandles = this.createHandles();
      }
      this.resizeHandles.setVisible(true);
    } else if (this.resizeHandles) {
      this.resizeHandles.setVisible(false);
    }
  }

  isSelected(): boolean {
    return this.selected;
  }

  /**
   * Resize the corner handles to a constant screen-pixel size. Call
   * when the camera's zoom or canvas aspect changes. No-op when
   * handles are not currently visible.
   */
  rescaleResizeHandles(): void {
    this.resizeHandles?.rescale();
  }

  dispose(): void {
    // Remove from HighlightLayer first while the mesh is still alive.
    if (this.selected) {
      setMeshHighlight(this.scene, this.mesh, null);
    }
    this.resizeHandles?.dispose();
    this.resizeHandles = null;
    this.shapeGroup?.dispose();
    this.shapeGroup = null;
    this.mesh.dispose();
    this.hitMaterial.dispose();
    this.transform.dispose();
  }
}
