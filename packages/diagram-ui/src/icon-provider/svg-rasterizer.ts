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
    // Sampling setup tuned for vector-icon style content (sharp edges,
    // mostly flat fills). Three things at play:
    //
    //   1. Mipmaps are generated (`noMipmap = false`) and read via
    //      `TRILINEAR_SAMPLINGMODE` (= LINEAR_LINEAR_MIPLINEAR). This
    //      kills the aliasing/sparkle on small on-screen sizes that
    //      the previous BILINEAR (no-mip) setup produced.
    //
    //   2. `anisotropicFilteringLevel = 16` (hardware max on most
    //      modern GPUs; Babylon clamps if not supported). Standard
    //      explanation: helps oblique angles. The under-told story:
    //      anisotropic also dramatically improves *minification*
    //      quality on perpendicular views by oversampling the
    //      texture per fragment instead of averaging adjacent
    //      texels. That's the bulk of the "icons blurry when zoomed
    //      out" fix.
    //
    //   3. `wrapU/wrapV = CLAMP_ADDRESSMODE`. Default `WRAP` repeats
    //      the texture — at low mip levels the rightmost texel
    //      bleeds with the leftmost (and vice versa), softening
    //      edges of the icon's bounding rectangle. CLAMP stops that.
    const tex: Texture = new Texture(
      dataUrl,
      scene,
      false /* noMipmap */,
      true /* invertY */,
      Texture.TRILINEAR_SAMPLINGMODE,
      () => {
        tex.hasAlpha = true;
        tex.anisotropicFilteringLevel = 16;
        tex.wrapU = Texture.CLAMP_ADDRESSMODE;
        tex.wrapV = Texture.CLAMP_ADDRESSMODE;
        if (DEBUG_RASTERIZER) {
          console.debug("[diagram-ui] SVG texture ready", {
            size: { w: tex.getSize().width, h: tex.getSize().height },
            hasAlpha: tex.hasAlpha,
            svgPreview: svg.slice(0, 200),
          });
        }
        resolve(tex);
      },
      (message, exception) => {
        console.error(
          "[diagram-ui] SVG → Texture load failed:",
          message,
          exception,
          { svgPreview: svg.slice(0, 200) },
        );
        reject(new Error(`Failed to decode SVG: ${message ?? "unknown"}`));
      },
    );
  });
}

/**
 * Flip to `true` to log every successful texture load with size,
 * hasAlpha, and a 200-char SVG preview. Useful when icons render but
 * with the wrong content. Off by default to keep production console
 * noise low.
 */
let DEBUG_RASTERIZER = false;

/** Toggle the rasteriser's verbose logging at runtime. */
export function setRasterizerDebug(enabled: boolean): void {
  DEBUG_RASTERIZER = enabled;
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
