import { customElement, property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { CanvasTextMetrics, Text, TextStyle, type Container } from "pixi.js";
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
import {
  FONT_FIT_FACTOR,
  TRIAL_FONT_SIZE,
  fitFontSize,
  quantizeTextResolution,
} from "./text-sizing.js";
import { substitutionsContext } from "../label/substitutions-context.js";
import { worldScaleXY } from "../scene/ortho-camera.js";

/**
 * `<om-text>` — one Modelica `TextShape`, rendered as a Pixi `Text`. The text
 * counter-flips locally (`scale.y < 0`) so it stays upright under the diagram
 * root's Y-flip, and its `resolution` follows the zoom in both directions so
 * glyphs stay crisp zoomed in and keep sampling near their rendered size
 * zoomed out (see `quantizeTextResolution` for the floor/ceiling rule).
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
  private currentResolution = 1;

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
    this.currentResolution = 1;

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

    const fontFamily =
      s.fontName && s.fontName.length > 0 ? s.fontName : "sans-serif";
    const align = horizontalAlign(s.horizontalAlignment);
    const fontSize =
      s.fontSize && s.fontSize > 0
        ? s.fontSize * FONT_FIT_FACTOR
        : fittedFontSize(body, fontFamily, align, width, height);

    const style = new TextStyle({
      fontFamily,
      fontSize: Math.max(0.01, fontSize),
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
   * Retarget the `Text` resolution to the on-screen texel density at the
   * current zoom — both directions, quantized by `quantizeTextResolution`
   * so a pure pan (and small zoom jitter within a quantization step) is a
   * no-op rather than a re-rasterize.
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
    const target = quantizeTextResolution(density);
    if (target === this.currentResolution) {
      return;
    }
    this.currentResolution = target;
    text.resolution = target;
    this.requestRender();
  }
}

/**
 * Font size for Modelica `fontSize == 0` — §18.6.5.5: scale the text to
 * fit the extent. Measures the string at a trial size and fits both
 * dimensions with a uniform scale (`fitFontSize`). Falls back to a
 * height-proportional size when glyph metrics are unavailable (headless:
 * no 2D canvas — width then goes unchecked, matching what a renderer-less
 * build can know).
 */
function fittedFontSize(
  body: string,
  fontFamily: string,
  align: Align,
  width: number,
  height: number,
): number {
  try {
    const m = CanvasTextMetrics.measureText(
      body,
      new TextStyle({ fontFamily, fontSize: TRIAL_FONT_SIZE, align }),
    );
    const fitted = fitFontSize(width, height, m.width, m.height);
    if (fitted !== null) {
      return fitted;
    }
  } catch {
    // No measurable 2D context; use the heuristic below.
  }
  return height * FONT_FIT_FACTOR;
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
