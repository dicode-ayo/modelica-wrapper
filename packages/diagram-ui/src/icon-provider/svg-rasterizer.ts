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
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
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

function loadImage(src: string, size: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(size, size);
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode SVG"));
    img.src = src;
  });
}
