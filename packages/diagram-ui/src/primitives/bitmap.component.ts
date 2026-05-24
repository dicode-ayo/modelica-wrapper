import { customElement, property } from "lit/decorators.js";
import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Texture,
  type TransformNode,
} from "@babylonjs/core";
import type { BitmapShape } from "@dicode/omc-client";

import { OmShapePrimitive } from "./shape-primitive.js";
import { extentToRect, graphicItemNode } from "./shape-utils.js";

/**
 * `<om-bitmap>` — one Modelica `BitmapShape`. Loads either a base64
 * `imageSource` or a remote `fileName` into a `Texture` and paints it
 * on a sized plane.
 */
@customElement("om-bitmap")
export class OmBitmap extends OmShapePrimitive {
  @property({ attribute: false })
  shape: BitmapShape | null = null;

  protected override fingerprint(): string {
    return JSON.stringify(this.shape);
  }

  protected override buildMeshes(parent: TransformNode, z: number): void {
    const s = this.shape;
    if (!s) {
      return;
    }
    const scene = parent.getScene();
    const { x, y, width, height } = extentToRect(s.extent);
    if (width <= 0 || height <= 0) {
      return;
    }
    const url = resolveBitmapUrl(s);
    if (!url) {
      return;
    }

    const baseName = `om-bitmap.${this.zOrder}`;
    const texture = new Texture(url, scene, true, false);
    texture.hasAlpha = true;

    const material = new StandardMaterial(`${baseName}.mat`, scene);
    material.disableLighting = true;
    material.specularColor = new Color3(0, 0, 0);
    material.emissiveColor = new Color3(1, 1, 1);
    material.diffuseTexture = texture;
    material.emissiveTexture = texture;
    material.useAlphaFromDiffuseTexture = true;
    material.backFaceCulling = false;

    const gi = graphicItemNode(parent, s, `${baseName}.gi`);
    const plane = MeshBuilder.CreatePlane(
      `${baseName}.plane`,
      { width, height, sideOrientation: Mesh.DOUBLESIDE },
      scene,
    );
    plane.material = material;
    plane.parent = gi.node;
    plane.position.set(x + width / 2, y + height / 2, z);
    plane.isPickable = false;

    this.resources.push({
      dispose(): void {
        plane.dispose();
        material.dispose();
        texture.dispose();
      },
    });
    this.resources.push(gi);
  }
}

function resolveBitmapUrl(s: BitmapShape): string | undefined {
  const src = s.imageSource;
  if (typeof src === "string" && src.length > 0) {
    if (src.startsWith("data:")) return src;
    // Raw base64 PNG signature: `iVBOR...`. Wrap it so the texture
    // loader recognises the encoding.
    if (src.startsWith("iVBOR")) return `data:image/png;base64,${src}`;
    return src;
  }
  if (typeof s.fileName === "string" && s.fileName.length > 0) {
    return s.fileName;
  }
  return undefined;
}

declare global {
  interface HTMLElementTagNameMap {
    "om-bitmap": OmBitmap;
  }
}
