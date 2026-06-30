import { ImageSource, Texture, TextureStyle } from "pixi.js";

/**
 * Browser-side rasteriser: turns an SVG string into a Pixi `Texture` by
 * decoding the SVG as a base64 data URL into an `<img>` and uploading it
 * as an `ImageSource`. `img.decode()` resolves only once the bitmap is
 * fully decoded, so the texture source has real pixels by the time the
 * Promise settles — matching the IconCache's "promise-per-request"
 * contract.
 *
 * Sampling is tuned for vector-icon content (sharp edges, mostly flat
 * fills):
 *
 *  - Mipmaps + trilinear (`scaleMode:'linear'`, `mipmapFilter:'linear'`)
 *    kill aliasing/sparkle at small on-screen sizes.
 *  - `maxAnisotropy:16` oversamples per fragment, which is the bulk of the
 *    "icons blurry when zoomed out" fix (improves minification, not just
 *    oblique angles).
 *  - `clamp-to-edge` stops the texture's right/bottom edge bleeding into
 *    the left/top at low mip levels, which would soften the icon's
 *    bounding rectangle.
 *
 * No `invertY`: Pixi textures are upright/+Y-down. The Sprite that paints
 * this texture counter-flips locally under the flipped world transform.
 */
export async function rasterizeSvgToTexture(
  svg: string,
  size: number,
): Promise<Texture> {
  void size; // size is baked into the SVG by the icon-provider
  const base64 = base64EncodeUnicode(svg);
  const dataUrl = `data:image/svg+xml;base64,${base64}`;

  const img = new Image();
  img.src = dataUrl;
  try {
    await img.decode();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error("[diagram-ui] SVG → Texture decode failed:", cause, {
      svgPreview: svg.slice(0, 200),
    });
    throw new Error(`Failed to decode SVG: ${message}`);
  }

  const source = new ImageSource({
    resource: img,
    alphaMode: "premultiply-alpha-on-upload",
    autoGenerateMipmaps: true,
  });
  source.style = new TextureStyle({
    scaleMode: "linear",
    mipmapFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    maxAnisotropy: 16,
  });

  const texture = new Texture({ source });
  if (rasterizerDebug) {
    console.debug("[diagram-ui] SVG texture ready", {
      size: { w: texture.width, h: texture.height },
      svgPreview: svg.slice(0, 200),
    });
  }
  return texture;
}

/**
 * Flip to `true` to log every successful texture load with size and a
 * 200-char SVG preview. Useful when icons render but with the wrong
 * content. Off by default to keep production console noise low.
 */
let rasterizerDebug = false;

/** Toggle the rasteriser's verbose logging at runtime. */
export function setRasterizerDebug(enabled: boolean): void {
  rasterizerDebug = enabled;
}

/** Base64-encode a UTF-8 string. `btoa` chokes on non-ASCII; this path
 *  re-encodes through a Uint8Array → binary string so any unicode
 *  glyphs in the SVG text labels survive. */
function base64EncodeUnicode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
