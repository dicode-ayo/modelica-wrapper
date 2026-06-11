/**
 * Pure resolution math for the zoom-dependent `<om-text>` texture. No
 * Babylon, no DOM — given the camera's orthographic extents and the
 * label's icon-space size, it derives the canvas edge (in texels) that
 * keeps texel density at or above one texel per on-screen device pixel.
 *
 * The `<om-text>` plane spans `iconUnits` units in its parent's local
 * space. Under the orthographic camera those units land on screen at
 * `worldScale / worldPerPixel` device pixels each, so a label needs
 * `iconUnits * worldScale / worldPerPixel` texels along an edge to hit
 * 1 texel/pixel. The result is clamped to `[minEdge, maxEdge]`: the
 * floor keeps tiny extents legible, the ceiling caps GPU allocation and
 * respects the engine's maximum texture size.
 */

export interface TextureEdgeBounds {
  /** Smallest canvas edge, in texels. Keeps tiny labels legible. */
  minEdge: number;
  /** Largest canvas edge, in texels. Caps allocation / GPU limits. */
  maxEdge: number;
}

/**
 * World units per on-screen device pixel for an orthographic camera:
 * `(orthoRight − orthoLeft) / renderWidth`. Returns `Infinity` for a
 * degenerate render width so callers fall back to a clamp.
 */
export function worldPerPixel(
  orthoLeft: number,
  orthoRight: number,
  renderWidth: number,
): number {
  if (renderWidth <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return (orthoRight - orthoLeft) / renderWidth;
}

/**
 * Texture edge (texels) for a label `iconUnits` long, given its parent's
 * world scale and the current `worldPerPixel`. Rounded up so the texel
 * count never dips below the screen-pixel count, then clamped to
 * `bounds`. A non-finite or non-positive `worldPerPixel` yields
 * `bounds.minEdge` (no zoom information → smallest legible texture).
 */
export function targetTextureEdge(
  iconUnits: number,
  worldScale: number,
  worldPerPixelValue: number,
  bounds: TextureEdgeBounds,
): number {
  if (!Number.isFinite(worldPerPixelValue) || worldPerPixelValue <= 0) {
    return bounds.minEdge;
  }
  const screenPixels = (iconUnits * worldScale) / worldPerPixelValue;
  const edge = Math.ceil(screenPixels);
  return Math.min(bounds.maxEdge, Math.max(bounds.minEdge, edge));
}
