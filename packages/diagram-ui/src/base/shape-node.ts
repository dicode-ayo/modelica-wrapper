import {
  Color3,
  Material,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Texture,
  TransformNode,
  type Scene,
} from "@babylonjs/core";

import { applyPlacement, type AppliedTransform } from "./placement-math.js";
import { ResizeHandles, ensureHighlightLayer } from "./selection-overlay.js";
import type {
  CoordinateSystem,
  Placement,
} from "@modelica-wrapper/omc-client";

const HIGHLIGHT_COLOR = new Color3(0.38, 0.6, 0.98);

/**
 * Faint magenta — visible against the white scene background but soft
 * enough not to be mistaken for an actual icon colour. Replaces the
 * pure-black fallback that the previous "icons black" reports showed
 * (mesh rendered, no texture bound).
 */
const MISSING_TEXTURE_COLOR = new Color3(1, 0.6, 0.9);

/**
 * Babylon-side wrapper around the TransformNode + textured plane mesh
 * pair that every entity element drives. The wrapper exposes a small
 * imperative surface (`setPlacement`, `setTexture`, `setSelected`,
 * `dispose`) so the Lit element layer stays focused on lifecycle.
 *
 * Coordinate behaviour matches `placement-math.ts`:
 *   - The TransformNode is anchored at the placement origin + extent
 *     centre in the parent's coord system.
 *   - The plane mesh is sized to the icon coord system (`width` ×
 *     `height`) and offset to the icon centre, so children attaching
 *     directly to `transform` get the icon's local coord system.
 *   - Rotation is around `transform.position` (the placement origin).
 */
export class OmShapeNode {
  readonly transform: TransformNode;
  private readonly material: StandardMaterial;
  readonly mesh: Mesh;

  private currentIconWidth = 1;
  private currentIconHeight = 1;
  private currentIconCx = 0;
  private currentIconCy = 0;
  private selected = false;
  private resizeHandles: ResizeHandles | null = null;
  private readonly scene: Scene;

  constructor(scene: Scene, parent: TransformNode, name = "om-shape") {
    this.scene = scene;
    this.transform = new TransformNode(name, scene);
    this.transform.parent = parent;

    // Unlit-with-alpha setup. The StandardMaterial fragment shader
    // emits `emissiveTexture.rgb * intensity + emissiveColor` when an
    // emissive texture is bound, so `emissiveColor` MUST stay at
    // (0, 0, 0) when a texture is bound — anything else gets *added*
    // and clamped to white. Before a texture loads we use a faint
    // magenta tint (classic "missing texture") so the plane is
    // visibly distinct from a successfully-rendered icon. setTexture
    // resets `emissiveColor` to black once the real texture lands.
    //
    //   - `emissiveTexture` supplies the icon colour. `disableLighting`
    //     skips diffuse + ambient so the output is the texture pixel
    //     as-is, regardless of scene lights MultiBody mode may add.
    //   - `diffuseTexture` + `useAlphaFromDiffuseTexture` makes the
    //     fragment alpha track the texture's alpha channel.
    //
    // `backFaceCulling = false` keeps the icon visible from both sides
    // (useful when the camera flips into 3D mode for MultiBody view).
    this.material = new StandardMaterial(`${name}-mat`, scene);
    this.material.disableLighting = true;
    this.material.specularColor = new Color3(0, 0, 0);
    this.material.emissiveColor = MISSING_TEXTURE_COLOR.clone();
    this.material.backFaceCulling = false;
    this.material.useAlphaFromDiffuseTexture = true;

    // Mesh name uses a `plane.<owner>` prefix instead of
    // `<owner>-mesh` because `entityKeyForNode`'s regex matches
    // `^om-(component|connector|label):` and would otherwise capture
    // `gain1-mesh` as the nodeId — breaking selection and drag (the
    // key wouldn't match `layout.components["gain1"]`). The new
    // prefix doesn't start with `om-` so it's transparent to the
    // entity-key walker; the walker resolves the owner via the
    // parent TransformNode instead. Inspector readability is the
    // same — the prefix tells you which entity it belongs to.
    this.mesh = MeshBuilder.CreatePlane(
      `plane.${name}`,
      { width: 1, height: 1, sideOrientation: Mesh.DOUBLESIDE },
      scene,
    );
    this.mesh.material = this.material;
    this.mesh.parent = this.transform;
    this.mesh.isPickable = true;
  }

  /**
   * Applies a placement (extent + optional origin + optional rotation
   * in degrees) and resizes the plane mesh to the icon coordinate
   * system so children can attach directly to `transform` using
   * icon-coord units.
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

    if (
      this.currentIconWidth !== t.iconSize.width ||
      this.currentIconHeight !== t.iconSize.height
    ) {
      this.currentIconWidth = t.iconSize.width;
      this.currentIconHeight = t.iconSize.height;
      this.mesh.scaling.set(t.iconSize.width, t.iconSize.height, 1);
      // Resize handles are pinned to the icon corners — rebuild if size
      // changed.
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

  setTexture(texture: Texture | null): void {
    if (texture) {
      texture.hasAlpha = true;
    }
    // diffuseTexture carries the alpha channel for transparency;
    // emissiveTexture carries the colour for unlit rendering. Same
    // Babylon Texture object on both slots — Babylon dedupes the
    // GPU upload internally, so this is one resource.
    this.material.emissiveTexture = texture;
    this.material.diffuseTexture = texture;
    this.material.opacityTexture = null;
    // With a texture bound the shader does `sample + emissiveColor`,
    // so set the fallback colour to black; revert to the
    // missing-texture magenta if the binding is cleared.
    if (texture) {
      this.material.emissiveColor.set(0, 0, 0);
    } else {
      this.material.emissiveColor.copyFrom(MISSING_TEXTURE_COLOR);
    }
  }

  /**
   * Toggle whether the in-canvas textured plane paints anything. When
   * the HTML overlay is the visible icon (orthographic camera) we
   * flip this off — the overlay covers the same area, so the
   * texture rasterisation + GPU sample is wasted work.
   *
   * Implementation notes:
   *   - Toggle `material.alpha` (0 / 1) instead of
   *     `mesh.isVisible = false`. `HighlightLayer._internalRender`
   *     skips invisible meshes, and we still want the selection
   *     outline in 2D mode — material alpha is independent of the
   *     highlight silhouette pass.
   *   - The transparency mode STAYS `MATERIAL_ALPHABLEND` in both
   *     states. Icon SVGs have transparent background pixels with
   *     RGB = (0,0,0) and alpha = 0; under `MATERIAL_OPAQUE` the
   *     alpha is ignored and those pixels render as solid black,
   *     swallowing rectangular blocks behind a black square. Alpha
   *     blending respects the texture alpha so only the visible
   *     shape strokes/fills show.
   */
  setInCanvasVisible(visible: boolean): void {
    this.material.alpha = visible ? 1 : 0;
    this.material.transparencyMode = Material.MATERIAL_ALPHABLEND;
  }

  setSelected(selected: boolean): void {
    if (this.selected === selected) {
      return;
    }
    this.selected = selected;

    // Highlight outline (no-op under NullEngine).
    const layer = ensureHighlightLayer(this.scene);
    if (layer) {
      if (selected) {
        layer.addMesh(this.mesh, HIGHLIGHT_COLOR);
      } else {
        layer.removeMesh(this.mesh);
      }
    }

    // Resize handles.
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

  dispose(): void {
    // Remove from HighlightLayer first while the mesh is still alive.
    const layer = ensureHighlightLayer(this.scene);
    if (layer && this.selected) {
      layer.removeMesh(this.mesh);
    }
    this.resizeHandles?.dispose();
    this.resizeHandles = null;
    this.mesh.dispose();
    this.material.dispose();
    this.transform.dispose();
    // Disposing the material leaves the texture alive — textures are
    // owned by the icon-provider cache and shared across nodes.
  }
}
