import { BitmapText, HTMLText, Text, type TextStyleOptions } from "pixi.js";
import { assertUnreachable } from "@dicode/modelica-lang-core";

/**
 * Which Pixi text class `<om-text>` instantiates.
 *
 * - `bitmap` — `BitmapText`. Its atlas is keyed on font family, fill and
 *   weight but not size, since the font bakes at a canonical size and
 *   scales, so a diagram's whole ladder of Modelica `fontSize`s shares one
 *   atlas and `ensureCharacters` grows the glyph set on demand. The atlas
 *   density is fixed and there is no per-instance `resolution`.
 * - `canvas` — `Text`. Rasterized through a 2D canvas into its own texture
 *   per string. The only class whose `resolution` can be raised on zoom-in.
 * - `html` — `HTMLText`. Laid out by the browser via an SVG `foreignObject`.
 *   Its texture resolves after the draw that requests it, and it drops text
 *   below roughly a pixel of rendered height.
 */
export type TextMode = "canvas" | "bitmap" | "html";

export type SceneText = Text | BitmapText | HTMLText;

export const DEFAULT_TEXT_MODE: TextMode = "bitmap";

export function createSceneText(
  mode: TextMode,
  options: { text: string; style: TextStyleOptions },
): SceneText {
  switch (mode) {
    case "bitmap":
      return new BitmapText(options);
    case "html":
      return new HTMLText(options);
    case "canvas":
      return new Text(options);
    default:
      return assertUnreachable(mode, "TextMode");
  }
}

/**
 * `BitmapText` resolution is fixed by the font atlas at install time and
 * writing the property logs a warning, so the zoom ramp must skip it.
 */
export function supportsDynamicResolution(text: SceneText): boolean {
  return !(text instanceof BitmapText);
}

/**
 * `HTMLText` rasterizes through an SVG-to-image step that its render pipe
 * only starts *during* a draw, so the texture resolves one or more frames
 * after the draw that requested it. Under the on-demand scheduler nothing
 * schedules the frame that would then paint it and the glyphs never
 * appear, so follow-up frames have to be nudged.
 */
export function requiresDeferredRasterization(text: SceneText): boolean {
  return text instanceof HTMLText;
}
