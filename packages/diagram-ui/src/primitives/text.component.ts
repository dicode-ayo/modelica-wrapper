import { customElement, property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { Text, TextStyle, type Container } from "pixi.js";
import {
  interpolateTemplate,
  type TextSubstitutions,
} from "@dicode/diagram-svg";
import type { TextShape } from "@dicode/omc-client";
import { expressionToString } from "@dicode/omc-client/eval";

import {
  OmShapePrimitive,
  extentEntityBounds,
  type EntityBounds,
} from "./shape-primitive.js";
import { colorToCss, extentToRect } from "./shape-utils.js";
import { substitutionsContext } from "../label/substitutions-context.js";
import { worldScaleXY } from "../scene/ortho-camera.js";

/**
 * Em-size vs box-height fudge: a `font-size: Npx` font has cap+descender
 * height ≈ 0.95N, so a glyph sized to the full extent height overshoots the
 * box. Pulling the rendered font down by this factor keeps glyphs inside the
 * extent — matching the on-screen size OMEdit draws.
 */
const FONT_FIT_FACTOR = 0.7;

/** Floor on the `Text` resolution. Keeps tiny labels legible when zoomed
 *  out — the glyphs would otherwise rasterize to a handful of texels. */
const MIN_TEXT_RESOLUTION = 1;
/** Ceiling on the `Text` resolution. Caps glyph-atlas allocation on deep
 *  zoom; a label gains nothing visible past this density. */
const MAX_TEXT_RESOLUTION = 8;

/**
 * `<om-text>` — one Modelica `TextShape`, rendered as a Pixi `Text`. The text
 * counter-flips locally (`scale.y < 0`) so it stays upright under the diagram
 * root's Y-flip, and its `resolution` is raised on zoom-in so glyphs stay
 * crisp (it is never lowered on zoom-out — the cap bounds the atlas).
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

  private text: Text | null = null;
  private currentResolution = MIN_TEXT_RESOLUTION;

  /** Raise the `Text` resolution to match the new zoom (never lowered). */
  protected override onViewChange(): void {
    this.applyResolution();
  }

  /** Body to draw — `textString` resolved against the in-scope
   *  substitutions. */
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
    // edits a modifier and the parameters map updates) re-runs buildMeshes.
    // The raw shape JSON alone wouldn't change.
    return `${this.resolvedBody()}|${JSON.stringify(this.shape)}`;
  }

  protected override entityKind(): string {
    return "text";
  }

  protected override entityBounds(): EntityBounds | null {
    return this.shape ? extentEntityBounds(this.shape) : null;
  }

  protected override buildMeshes(
    parent: Container,
    z: number,
    inEntityFrame = false,
  ): void {
    this.text = null;
    this.currentResolution = MIN_TEXT_RESOLUTION;

    const s = this.shape;
    if (!s) {
      return;
    }
    const { x, y, width, height } = extentToRect(s.extent);
    if (width <= 0 || height <= 0) {
      return;
    }
    const body = this.resolvedBody();
    if (!body) {
      return;
    }

    // Modelica `fontSize == 0` means "auto-fit to extent": default to the
    // extent height so the glyph is proportional to the box.
    const fontUnits = s.fontSize && s.fontSize > 0 ? s.fontSize : height;
    const fontFamily =
      s.fontName && s.fontName.length > 0 ? s.fontName : "sans-serif";
    const align = horizontalAlign(s.horizontalAlignment);

    const style = new TextStyle({
      fontFamily,
      fontSize: Math.max(0.01, fontUnits * FONT_FIT_FACTOR),
      fill: colorToCss(s.textColor, "rgb(0,0,0)"),
      align,
    });
    const text = new Text({ text: body, style });
    text.label = `om-text.${this.zOrder}`;
    text.eventMode = "none";
    text.zIndex = z;
    text.resolution = this.currentResolution;
    // Anchor at the horizontal alignment edge and vertical centre; the local
    // Y-flip pivots about that anchor so the glyph stays upright and in place.
    text.anchor.set(anchorX(align), 0.5);
    text.scale.set(1, -1);
    text.position.set(alignX(align, x, width), y + height / 2);

    const root = this.graphicRoot(
      parent,
      s,
      `om-text.${this.zOrder}.gi`,
      inEntityFrame,
      z,
    );
    root.addChild(text);
    this.text = text;
    this.applyResolution();

    this.resources.push({
      dispose: () => {
        text.destroy();
        this.text = null;
      },
    });
  }

  /**
   * Raise the `Text` resolution to match the on-screen texel density at the
   * current zoom. No-op on pan and on zoom-out (resolution is never lowered —
   * the ceiling bounds the atlas).
   */
  private applyResolution(): void {
    const text = this.text;
    const ctx = this.sceneCtx;
    if (!text || !ctx) {
      return;
    }
    const wpp = ctx.worldPerPixel();
    if (!Number.isFinite(wpp) || wpp <= 0) {
      return;
    }
    // `worldScaleXY` excludes the view transform, so dividing by `worldPerPixel`
    // gives device pixels per text-local unit at this zoom.
    const scale = worldScaleXY(text);
    const density = Math.max(scale.x, scale.y) / wpp;
    const target = Math.min(
      MAX_TEXT_RESOLUTION,
      Math.max(MIN_TEXT_RESOLUTION, Math.ceil(density)),
    );
    if (target <= this.currentResolution) {
      return;
    }
    this.currentResolution = target;
    text.resolution = target;
    this.requestRender();
  }
}

type Align = "left" | "center" | "right";

function horizontalAlign(value: string | undefined): Align {
  switch (value) {
    case "Left":
      return "left";
    case "Right":
      return "right";
    default:
      return "center";
  }
}

function anchorX(align: Align): number {
  return align === "left" ? 0 : align === "right" ? 1 : 0.5;
}

function alignX(align: Align, x: number, width: number): number {
  return align === "left" ? x : align === "right" ? x + width : x + width / 2;
}

declare global {
  interface HTMLElementTagNameMap {
    "om-text": OmText;
  }
}
