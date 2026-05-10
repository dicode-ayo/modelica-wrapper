import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Texture,
  TransformNode,
  type Scene,
} from "@babylonjs/core";

import { applyPlacement, type AppliedTransform } from "./placement-math.js";
import type {
  CoordinateSystem,
  Placement,
} from "@modelica-wrapper/omc-client";

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
  private selected = false;

  constructor(scene: Scene, parent: TransformNode, name = "om-shape") {
    this.transform = new TransformNode(name, scene);
    this.transform.parent = parent;

    this.material = new StandardMaterial(`${name}-mat`, scene);
    this.material.disableLighting = true;
    this.material.specularColor = new Color3(0, 0, 0);
    this.material.emissiveColor = new Color3(1, 1, 1);
    this.material.backFaceCulling = false;
    this.material.useAlphaFromDiffuseTexture = true;

    this.mesh = MeshBuilder.CreatePlane(
      `${name}-mesh`,
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
  ): AppliedTransform {
    const t = applyPlacement(placement, iconCoordSystem);
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
    }
    this.mesh.position.set(t.meshLocal.x, t.meshLocal.y, 0);
    return t;
  }

  setTexture(texture: Texture | null): void {
    if (texture) {
      texture.hasAlpha = true;
    }
    this.material.diffuseTexture = texture;
    this.material.opacityTexture = texture;
  }

  setSelected(selected: boolean): void {
    this.selected = selected;
    // Selection visuals land in stage E2 (HighlightLayer + resize handles);
    // here we only track the flag so the element can read it back.
  }

  isSelected(): boolean {
    return this.selected;
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
    this.transform.dispose();
    // Disposing the material leaves the texture alive — textures are
    // owned by the icon-provider cache and shared across nodes.
  }
}
