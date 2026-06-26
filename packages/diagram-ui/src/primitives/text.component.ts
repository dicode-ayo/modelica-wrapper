import { customElement, property } from "lit/decorators.js";
import { ContextConsumer, consume } from "@lit/context";
import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  type Scene,
  type TransformNode,
} from "@babylonjs/core";
import {
  expressionToString,
  interpolateTemplate,
  type TextSubstitutions,
} from "@dicode/diagram-svg";
import type { TextShape } from "@dicode/omc-client";

import {
  OmShapePrimitive,
  extentEntityBounds,
  type EntityBounds,
} from "./shape-primitive.js";
import { colorToCss, extentToRect } from "./shape-utils.js";
import { substitutionsContext } from "../label/substitutions-context.js";
import {
  viewStateContext,
  type ViewStateStore,
} from "../scene/view-state-store.js";
import {
  targetTextureEdge,
  worldPerPixel,
  type TextureEdgeBounds,
} from "../scene/text-resolution.js";
import { findOrthoCamera, worldScaleXY } from "../scene/ortho-camera.js";

/**
 * Floor on the texture edge in texels. Keeps tiny extents legible when
 * zoomed out — at `worldPerPixel` the computed edge would round down to
 * a handful of texels and the glyphs would be unreadable.
 */
const MIN_TEXT_TEXTURE_EDGE = 8;
/**
 * Ceiling on the texture edge in texels. Caps GPU allocation on deep
 * zoom and stays well under the engine's maximum texture size; a label
 * gains nothing visible past this density.
 */
const MAX_TEXT_TEXTURE_EDGE = 4096;
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

const TEXTURE_EDGE_BOUNDS: TextureEdgeBounds = {
  minEdge: MIN_TEXT_TEXTURE_EDGE,
  maxEdge: MAX_TEXT_TEXTURE_EDGE,
};

/** Resolved label inputs the canvas bake needs, independent of the
 *  Babylon shape. */
interface TextDrawSpec {
  body: string;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  fillStyle: string;
  align: string;
}

/**
 * `<om-text>` — one Modelica `TextShape`. Backed by a `DynamicTexture`
 * — the text string is drawn into a canvas and uploaded as a texture
 * on the entity's plane mesh. Re-renders on a structural change (see
 * `OmShapePrimitive.fingerprint`) and re-bakes the texture at a higher
 * resolution when zoom raises the on-screen texel density past the
 * baked edge, so the label stays crisp when zoomed in.
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

  /** Live plane + material reused across re-textures; only the
   *  `DynamicTexture` is swapped when the resolution changes. */
  private plane: Mesh | null = null;
  private material: StandardMaterial | null = null;
  private texture: DynamicTexture | null = null;
  private drawSpec: TextDrawSpec | null = null;
  /** Edge (texels) of the currently baked texture. */
  private bakedEdge = 0;
  private viewUnsub: (() => void) | null = null;

  constructor() {
    super();
    new ContextConsumer(this, {
      context: viewStateContext,
      subscribe: true,
      callback: (store) => this.resubscribeViewState(store),
    });
  }

  private resubscribeViewState(store: ViewStateStore | null): void {
    this.viewUnsub?.();
    this.viewUnsub = store ? store.subscribe(() => this.retexture()) : null;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.viewUnsub?.();
    this.viewUnsub = null;
  }

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

  private resetTextureState(): void {
    this.plane = null;
    this.material = null;
    this.texture = null;
    this.drawSpec = null;
    this.bakedEdge = 0;
  }

  protected override entityKind(): string {
    return "text";
  }

  protected override entityBounds(): EntityBounds | null {
    return this.shape ? extentEntityBounds(this.shape) : null;
  }

  protected override buildMeshes(
    parent: TransformNode,
    z: number,
    inEntityFrame = false,
  ): void {
    this.resetTextureState();

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
    const fontSize = s.fontSize && s.fontSize > 0 ? s.fontSize : height;
    const fontFamily =
      s.fontName && s.fontName.length > 0 ? s.fontName : "sans-serif";

    const spec: TextDrawSpec = {
      body,
      width,
      height,
      fontSize,
      fontFamily,
      fillStyle: colorToCss(s.textColor, "rgb(0,0,0)"),
      align: s.horizontalAlignment ?? "Center",
    };
    this.drawSpec = spec;

    const baseName = `om-text.${this.zOrder}`;
    const material = new StandardMaterial(`${baseName}.mat`, scene);
    material.disableLighting = true;
    material.specularColor = new Color3(0, 0, 0);
    material.emissiveColor = new Color3(1, 1, 1);
    material.useAlphaFromDiffuseTexture = true;
    material.backFaceCulling = false;
    this.material = material;

    const root = this.graphicRoot(parent, s, `${baseName}.gi`, inEntityFrame);
    const plane = MeshBuilder.CreatePlane(
      `${baseName}.plane`,
      { width, height, sideOrientation: Mesh.DOUBLESIDE },
      scene,
    );
    plane.material = material;
    plane.parent = root;
    plane.position.set(x + width / 2, y + height / 2, z);
    plane.isPickable = false;
    this.plane = plane;

    this.bakeTexture(scene, spec, this.targetEdge(scene, spec));

    this.resources.push({
      dispose: () => {
        plane.dispose();
        material.dispose();
        this.texture?.dispose();
        this.resetTextureState();
      },
    });
  }

  /**
   * Re-bake the texture at the current zoom if on-screen texel density
   * has risen past the baked edge. Reuses the plane + material; only the
   * `DynamicTexture` is swapped. No-op on pan (target edge unchanged)
   * and on zoom-out (we never shed resolution — the cap bounds memory).
   */
  private retexture(): void {
    const plane = this.plane;
    const spec = this.drawSpec;
    if (!plane || !spec) {
      return;
    }
    const scene = plane.getScene();
    const target = this.targetEdge(scene, spec);
    if (target <= this.bakedEdge) {
      return;
    }
    this.bakeTexture(scene, spec, target);
    this.requestRender();
  }

  /** Texel edge for the label at the camera's current zoom, clamped to
   *  `[MIN, MAX]`. Falls back to the floor when no ortho camera is up. */
  private targetEdge(scene: Scene, spec: TextDrawSpec): number {
    const camera = findOrthoCamera(scene);
    const plane = this.plane;
    if (!camera || !plane) {
      return TEXTURE_EDGE_BOUNDS.minEdge;
    }
    const renderWidth = scene.getEngine().getRenderWidth() || 1;
    const wpp = worldPerPixel(
      camera.orthoLeft ?? -1,
      camera.orthoRight ?? 1,
      renderWidth,
    );
    const worldScale = worldScaleXY(plane);
    const scale = Math.max(worldScale.x, worldScale.y);
    const longEdge = Math.max(spec.width, spec.height);
    return targetTextureEdge(longEdge, scale, wpp, TEXTURE_EDGE_BOUNDS);
  }

  /** (Re)create the `DynamicTexture` so its long side is `edge` texels,
   *  draw the label into it, and bind it to the live material. */
  private bakeTexture(scene: Scene, spec: TextDrawSpec, edge: number): void {
    const longEdge = Math.max(spec.width, spec.height) || 1;
    const texW = Math.max(1, Math.round((spec.width / longEdge) * edge));
    const texH = Math.max(1, Math.round((spec.height / longEdge) * edge));

    const texture = new DynamicTexture(
      `om-text.${this.zOrder}.tex`,
      { width: texW, height: texH },
      scene,
      true,
    );
    texture.hasAlpha = true;

    const ctx = texture.getContext() as CanvasRenderingContext2D | null;
    if (ctx) {
      ctx.clearRect(0, 0, texW, texH);
      const pixelFont = Math.max(
        8,
        Math.round((spec.fontSize / spec.height) * texH * FONT_FIT_FACTOR),
      );
      ctx.font = `${pixelFont}px ${spec.fontFamily}`;
      ctx.fillStyle = spec.fillStyle;

      let drawX: number;
      switch (spec.align) {
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
      ctx.fillText(spec.body, drawX, texH / 2);
    }
    texture.update();

    const material = this.material;
    if (material) {
      material.diffuseTexture = texture;
      material.emissiveTexture = texture;
    }
    this.texture?.dispose();
    this.texture = texture;
    this.bakedEdge = edge;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-text": OmText;
  }
}
