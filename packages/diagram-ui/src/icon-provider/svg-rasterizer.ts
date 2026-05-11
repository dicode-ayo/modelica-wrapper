import { DynamicTexture, Texture } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";

/**
 * Browser-side rasteriser: turns an SVG string into a Babylon
 * `DynamicTexture` whose backing canvas is the rasterised icon.
 *
 * Architecture:
 *   1. Inject explicit width/height into the root `<svg>` if missing
 *      — without them, `<img>` reports `naturalWidth = 0` and
 *      `drawImage` paints nothing.
 *   2. Load the SVG into an `<img>` via a Blob `object: URL`.
 *   3. Create a Babylon `DynamicTexture` (canvas-backed, owned by
 *      Babylon and uploaded to GPU on `update()`); draw the image
 *      into the texture's canvas; call `update()` to push pixels to
 *      the GPU.
 *
 * `DynamicTexture` replaces the older canvas → `toDataURL` →
 * `Texture` chain that had two failure modes:
 *   - `toDataURL` taints the canvas if the browser ever inferred a
 *     cross-origin trace from the SVG, throwing SecurityError.
 *   - `new Texture(dataUrl, scene)` re-decodes the PNG asynchronously
 *     after we already paid the canvas-to-PNG cost, so the texture
 *     wasn't always ready by the time the next frame rendered.
 *
 * `DynamicTexture` skips both — its canvas is already a render
 * target, `update()` is synchronous, and there's no PNG round trip.
 *
 * The Promise resolves once `<img>.onload` fires; subsequent
 * `update()` is synchronous. Rejection on `<img>.onerror` lets the
 * IconCache evict the entry so a retry is possible.
 */
export async function rasterizeSvgToTexture(
  svg: string,
  scene: Scene,
  size: number,
): Promise<Texture> {
  const sized = ensureSvgDimensions(svg, size);
  const blob = new Blob([sized], { type: "image/svg+xml;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImage(objectUrl, size);
    const dt = new DynamicTexture(
      "om-icon",
      { width: size, height: size },
      scene,
      false /* generateMipMaps */,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    const ctx = dt.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    // `invertY = false` because the Babylon DynamicTexture canvas
    // already matches the upright image we just drew (image-y down,
    // which the diagram-svg renderer pre-flipped to compensate for
    // Modelica's y-up convention).
    dt.update(false);
    dt.hasAlpha = true;
    return dt;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Ensures the root `<svg>` carries explicit `width` / `height`
 * attributes. If both already exist they're left as-is; otherwise
 * they're inserted right after `<svg`. A missing root tag returns
 * the input unchanged — the downstream image load will fail and the
 * IconCache will evict + retry, which is the correct fallback.
 *
 * Exported for unit tests; production code reaches it through
 * `rasterizeSvgToTexture`.
 */
export function ensureSvgDimensions(svg: string, size: number): string {
  const open = svg.match(/<svg\b[^>]*>/i);
  if (!open) {
    return svg;
  }
  const tag = open[0];
  if (/\bwidth\s*=/i.test(tag) && /\bheight\s*=/i.test(tag)) {
    return svg;
  }
  const injected = tag.replace(/^<svg\b/i, `<svg width="${size}" height="${size}"`);
  return svg.replace(tag, injected);
}

function loadImage(src: string, size: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(size, size);
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode SVG"));
    img.src = src;
  });
}
