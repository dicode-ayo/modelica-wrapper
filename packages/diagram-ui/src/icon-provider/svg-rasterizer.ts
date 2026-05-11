import { Texture } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";

/**
 * Browser-side rasteriser: turns an SVG string into a Babylon
 * `Texture` by feeding the SVG as a base64 data URL straight to
 * Babylon's image loader. The previous canvas → toDataURL → Texture
 * chain (and its DynamicTexture replacement) had multiple failure
 * modes that all manifested as "icon is a black/white rectangle":
 *
 *  - `toDataURL` could throw `SecurityError` if the canvas was
 *    inferred to be cross-origin tainted.
 *  - `drawImage(svgImg, ...)` painted nothing when the SVG was
 *    missing explicit `width`/`height` (`<img>.naturalWidth = 0`).
 *  - `DynamicTexture.update()` masked GPU upload errors silently
 *    and we never learned why the texture was zeroed.
 *
 * Going straight to `new Texture(dataUrl, scene, ..., onLoad, onError)`:
 *  - Babylon owns the `<img>` element and texture upload.
 *  - `onError` surfaces decode failures on the console for visibility.
 *  - The SVG is guaranteed to have explicit dimensions because the
 *    icon-provider passes `size` to `renderIconLayersToSvg`.
 *
 * The Promise resolves once the texture's `onLoadObservable` fires,
 * matching the IconCache's "promise-per-request" contract.
 */
export async function rasterizeSvgToTexture(
  svg: string,
  scene: Scene,
  size: number,
): Promise<Texture> {
  void size; // size is baked into the SVG by the icon-provider
  // unescape() is deprecated; use the unicode-safe base64 path.
  const base64 = base64EncodeUnicode(svg);
  const dataUrl = `data:image/svg+xml;base64,${base64}`;

  return new Promise<Texture>((resolve, reject) => {
    const tex: Texture = new Texture(
      dataUrl,
      scene,
      false /* noMipmap */,
      true /* invertY */,
      Texture.BILINEAR_SAMPLINGMODE,
      () => {
        tex.hasAlpha = true;
        resolve(tex);
      },
      (message, exception) => {
        // eslint-disable-next-line no-console
        console.error("[diagram-ui] SVG → Texture load failed:", message, exception);
        reject(new Error(`Failed to decode SVG: ${message ?? "unknown"}`));
      },
    );
  });
}

/** Base64-encode a UTF-8 string. `btoa` chokes on non-ASCII; this path
 *  re-encodes through a Uint8Array → binary string so any unicode
 *  glyphs in the SVG text labels survive. */
function base64EncodeUnicode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/**
 * Retained for backward compatibility with the previous SVG-injection
 * path. Now a pass-through: the icon-provider passes an explicit
 * `size` to `renderIconLayersToSvg`, so the SVG already has explicit
 * `width` / `height` attributes by the time we see it.
 */
export function ensureSvgDimensions(svg: string, _size: number): string {
  return svg;
}
