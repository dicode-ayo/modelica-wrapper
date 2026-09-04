import { BitmapText, HTMLText, Text, type TextStyleOptions } from "pixi.js";

/**
 * Which Pixi text class `<om-text>` instantiates.
 *
 * - `bitmap` — `BitmapText`, the default. Glyphs come from an atlas keyed
 *   on font family, fill and weight — *not* size, since the font is baked
 *   at a canonical size and scaled — so a diagram's whole ladder of
 *   Modelica `fontSize`s shares one atlas, repeated strings cost almost
 *   nothing to draw, and `ensureCharacters` grows the glyph set on demand.
 *   The atlas has a fixed density and no per-instance `resolution`.
 * - `canvas` — `Text`. Rasterized through a 2D canvas into its own texture
 *   per string. The only mode whose `resolution` can be raised on zoom-in.
 * - `html` — `HTMLText`. Laid out by the browser via an SVG
 *   `foreignObject` and rasterized to a texture. Richest styling, slowest
 *   to build, and it drops text below roughly a pixel of rendered height.
 */
export type TextMode = "canvas" | "bitmap" | "html";

export type SceneText = Text | BitmapText | HTMLText;

let mode: TextMode = "bitmap";

/**
 * Swaps the text class used by subsequently-built `<om-text>` primitives.
 * Existing instances keep the class they were built with — `<om-text>`
 * creates its Pixi object in `buildMeshes`, so a switch needs those
 * rebuilt.
 */
export function setTextMode(next: TextMode): void {
  mode = next;
}

export function getTextMode(): TextMode {
  return mode;
}

export function createSceneText(options: {
  text: string;
  style: TextStyleOptions;
}): SceneText {
  switch (getTextMode()) {
    case "bitmap":
      return new BitmapText(options);
    case "html":
      return new HTMLText(options);
    default:
      return new Text(options);
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
