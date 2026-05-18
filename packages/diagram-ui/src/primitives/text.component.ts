import { customElement, property } from "lit/decorators.js";
import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  type TransformNode,
} from "@babylonjs/core";
import { expressionToString } from "@modelica-wrapper/diagram-svg";
import type { TextShape } from "@modelica-wrapper/omc-client";

import { OmShapePrimitive } from "./shape-primitive.js";
import { colorToCss, extentToRect } from "./shape-utils.js";

/** Modelica's "auto-fit" font size 0 → 12 user units (matches diagram-svg). */
const DEFAULT_FONT_SIZE = 12;
/** Canvas pixels per icon unit when sizing the DynamicTexture. */
const TEXT_TEXTURE_PIXELS_PER_UNIT = 4;
const MIN_TEXT_TEXTURE_EDGE = 32;

/**
 * `<om-text>` — one Modelica `TextShape`. Backed by a `DynamicTexture`
 * — the text string is drawn into a canvas and uploaded as a texture
 * on the entity's plane mesh. Re-renders only on a structural change
 * (see `OmShapePrimitive.fingerprint`), so an OMC roundtrip that
 * returns an identical shape doesn't flicker the label.
 */
@customElement("om-text")
export class OmText extends OmShapePrimitive {
  @property({ attribute: false })
  shape: TextShape | null = null;

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
    const body = expressionToString(s.textString);
    if (!body) {
      return;
    }

    const fontSize =
      s.fontSize && s.fontSize > 0 ? s.fontSize : DEFAULT_FONT_SIZE;
    const fontFamily =
      s.fontName && s.fontName.length > 0 ? s.fontName : "sans-serif";

    const texW = Math.max(
      MIN_TEXT_TEXTURE_EDGE,
      Math.round(width * TEXT_TEXTURE_PIXELS_PER_UNIT),
    );
    const texH = Math.max(
      MIN_TEXT_TEXTURE_EDGE,
      Math.round(height * TEXT_TEXTURE_PIXELS_PER_UNIT),
    );

    const baseName = `om-text.${this.zOrder}`;
    const texture = new DynamicTexture(
      `${baseName}.tex`,
      { width: texW, height: texH },
      scene,
      false,
    );
    texture.hasAlpha = true;

    const ctx = texture.getContext() as CanvasRenderingContext2D | null;
    if (ctx) {
      ctx.clearRect(0, 0, texW, texH);
      const pixelFont = Math.max(8, Math.round((fontSize / height) * texH));
      ctx.font = `${pixelFont}px ${fontFamily}`;
      ctx.fillStyle = colorToCss(s.textColor, "rgb(0,0,0)");

      const align = s.horizontalAlignment ?? "Center";
      let drawX: number;
      switch (align) {
        case "Left":
          ctx.textAlign = "left";
          drawX = 0;
          break;
        case "Right":
          ctx.textAlign = "right";
          drawX = texW;
          break;
        case "Center":
        default:
          ctx.textAlign = "center";
          drawX = texW / 2;
          break;
      }
      ctx.textBaseline = "middle";
      ctx.fillText(body, drawX, texH / 2);
      texture.update();
    }

    const material = new StandardMaterial(`${baseName}.mat`, scene);
    material.disableLighting = true;
    material.specularColor = new Color3(0, 0, 0);
    material.emissiveColor = new Color3(1, 1, 1);
    material.diffuseTexture = texture;
    material.emissiveTexture = texture;
    material.useAlphaFromDiffuseTexture = true;
    material.backFaceCulling = false;

    const plane = MeshBuilder.CreatePlane(
      `${baseName}.plane`,
      { width, height, sideOrientation: Mesh.DOUBLESIDE },
      scene,
    );
    plane.material = material;
    plane.parent = parent;
    plane.position.set(x + width / 2, y + height / 2, z);
    plane.isPickable = false;

    this.resources.push({
      dispose(): void {
        plane.dispose();
        material.dispose();
        texture.dispose();
      },
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-text": OmText;
  }
}
