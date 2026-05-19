import { customElement, property } from "lit/decorators.js";
import { consume } from "@lit/context";
import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  type TransformNode,
} from "@babylonjs/core";
import {
  expressionToString,
  interpolateTemplate,
  type TextSubstitutions,
} from "@modelica-wrapper/diagram-svg";
import type { TextShape } from "@modelica-wrapper/omc-client";

import { OmShapePrimitive } from "./shape-primitive.js";
import { colorToCss, extentToRect } from "./shape-utils.js";
import { substitutionsContext } from "../label/substitutions-context.js";

/** Canvas pixels per icon unit when sizing the DynamicTexture. */
const TEXT_TEXTURE_PIXELS_PER_UNIT = 4;
const MIN_TEXT_TEXTURE_EDGE = 32;
/**
 * Em-size vs glyph-height fudge: a CSS `font-size: Npx` font has total
 * cap+descender height ≈ 0.95N, with cap-height ≈ 0.72N. With
 * `textBaseline = "middle"` we centre the em-box, but the cap usually
 * extends above the box centre by `0.5 * cap-height ≈ 0.36N`. Pulling
 * the rendered pixel font down by this factor keeps the glyphs from
 * clipping the canvas top — at `fontSize == height` the cap would
 * otherwise overshoot the texture by a few pixels and look chopped.
 */
const FONT_FIT_FACTOR = 0.7;

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

  /**
   * `%`-substitution values inherited from the surrounding
   * `<om-component>` via Lit context. `null` outside a component
   * subtree — `textString` then renders verbatim (Modelica icons
   * outside any instance have no `%name` / `%paramName` to resolve).
   */
  @consume({ context: substitutionsContext, subscribe: true })
  private substitutions: TextSubstitutions | null = null;

  /** Body to draw — `textString` resolved against the in-scope
   *  substitutions. Computed in `resolvedBody()` and cached only via
   *  the fingerprint key so a modifier change rebuilds the texture. */
  private resolvedBody(): string {
    const s = this.shape;
    if (!s) return "";
    const raw = expressionToString(s.textString);
    if (!raw) return "";
    return this.substitutions
      ? interpolateTemplate(raw, this.substitutions)
      : raw;
  }

  protected override fingerprint(): string {
    // Include the resolved body so a substitution change (e.g. the user
    // edits a modifier and the parameters map updates) re-runs
    // buildMeshes. The raw shape JSON alone wouldn't change.
    return `${this.resolvedBody()}|${JSON.stringify(this.shape)}`;
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
    const body = this.resolvedBody();
    if (!body) {
      return;
    }

    // Modelica `fontSize == 0` means "auto-fit to extent". Defaulting
    // to the extent height (in icon units) makes the rendered font
    // proportional to the box. `diagram-svg` defaults to a hard 12 here,
    // which works for SVG (the browser handles overflow), but our
    // texture-on-plane pipeline clips at the canvas edge and stretches
    // the clipped slice onto the plane — produces a "huge font"
    // artefact when the extent is shorter than 12 user units.
    const fontSize =
      s.fontSize && s.fontSize > 0 ? s.fontSize : height;
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
      const pixelFont = Math.max(
        8,
        Math.round((fontSize / height) * texH * FONT_FIT_FACTOR),
      );
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
