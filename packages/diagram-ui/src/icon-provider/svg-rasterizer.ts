import { Texture } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";

/**
 * Browser-side rasteriser: turns an SVG string into a Babylon `Texture`
 * by routing it through `<img>` → `<canvas>` → PNG data URL → Texture.
 *
 * Babylon supports loading directly from an SVG data URL on most
 * platforms, but going through a canvas gives us:
 *   - explicit, deterministic pixel size (no DPR surprises)
 *   - a single texture object reused across uploads
 *   - mipmaps generated from a concrete bitmap (better minification)
 *
 * Returns a Promise that resolves once the image finishes loading. The
 * Promise rejects if the browser fails to decode the SVG, in which
 * case the caller (IconCache) drops the entry so a retry is possible.
 */
export async function rasterizeSvgToTexture(
  svg: string,
  scene: Scene,
  size: number,
): Promise<Texture> {
  // diagram-svg's renderer deliberately omits width/height on its
  // root <svg> so the icon can scale to its host container. That
  // works for HTML embedding but breaks the <img> path: Chrome /
  // Safari load such an SVG with naturalWidth = 0, and drawImage
  // then paints nothing. Inject explicit pixel dimensions before
  // handing the SVG to the browser image decoder so the rasterised
  // canvas actually receives bitmap data.
  const sized = ensureSvgDimensions(svg, size);
  const blob = new Blob([sized], { type: "image/svg+xml;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImage(objectUrl, size);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("No 2D context available");
    }
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    const dataUrl = canvas.toDataURL("image/png");
    return new Texture(
      dataUrl,
      scene,
      false /* noMipmap */,
      true /* invertY */,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
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
