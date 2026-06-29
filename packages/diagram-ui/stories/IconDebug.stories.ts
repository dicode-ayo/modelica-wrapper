/**
 * Diagnostic ladder for the icon texture pipeline. Each story
 * renders ONE textured `<om-debug-plane>` sprite and isolates a single
 * stage of the chain, so a regression is bisected at a glance:
 *
 *   1. `Baseline_NoTexture`
 *      Sprite with no texture — `Texture.WHITE` tinted with
 *      `fallbackColor` (red). If this *doesn't* show red → scene /
 *      sprite pipeline is broken (everything below depends on this).
 *
 *   2. `CanvasTexture_Procedural`
 *      Sprite from a `Texture.from(canvas)` painted directly via the
 *      canvas 2D context (blue square + white/red circles). If this
 *      shows but #1 didn't → texture binding works in isolation. If #2
 *      fails → the canvas → texture upload path is broken.
 *
 *   3. `PngDataUrl_NoMipmap`
 *      Sprite from a `Texture` decoded from a
 *      `canvas.toDataURL("image/png")` data URL, no mipmaps. Tests the
 *      browser's PNG decoder + Pixi's image upload.
 *
 *   4. `PngDataUrl_WithMipmap`
 *      Same PNG with mipmaps generated. Tests Pixi's mipmap chain. If #3
 *      works but #4 doesn't → mipmap generation is the culprit.
 *
 *   5. `SvgDataUrl_NoMipmap`
 *      Sprite from a `Texture` decoded from a base64 SVG data URL — the
 *      decode path the production rasteriser uses. Tests the SVG decoder
 *      specifically. If #3 works but #5 doesn't → SVG decode is the bug.
 *
 *   6. `SvgDataUrl_WithMipmap`
 *      Same as #5 with mipmaps. Some browsers refuse to mipmap an
 *      SVG-decoded image.
 *
 *   7. `SvgViaRasterizer_NoMipmap`
 *      Same SVG routed through the production `rasterizeSvgToTexture`.
 *      When `debug=true` the rasteriser logs `[diagram-ui] SVG texture
 *      ready { ... }` on success and `[diagram-ui] SVG → Texture decode
 *      failed` on failure.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import { ImageSource, Texture, TextureStyle } from "pixi.js";

import "../src/scene/scene.component.js";
import "../src/axis/grid-axis.component.js";
import "../src/debug/debug-plane.component.js";
import { rasterizeSvgToTexture } from "../src/icon-provider/svg-rasterizer.js";

interface StoryArgs {
  debug: boolean;
}

/** Red `0xRRGGBB` tint shown while a sprite has no texture. */
const FALLBACK_RED = 0xd93333;

// ── factories ──────────────────────────────────────────────────────

function noTextureFactory(): null {
  return null;
}

function canvasTextureFactory(): Texture {
  // 256×256 canvas painted programmatically, then uploaded straight to a
  // Pixi texture. Bypasses every decoder: no <img>, no PNG/SVG decode,
  // no network. If the sprite stays red here, the canvas → GPU upload
  // path is broken.
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2d canvas context unavailable");
  }
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#1e88e5"; // blue background
  ctx.fillRect(20, 20, size - 40, size - 40);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 70, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e53935"; // red dot
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 25, 0, Math.PI * 2);
  ctx.fill();
  return Texture.from(canvas);
}

function pngDataUrlFactory(noMipmap: boolean): () => Promise<Texture> {
  return () => {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2d canvas context unavailable");
    }
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#43a047"; // green
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 80px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("PNG", size / 2, size / 2);
    const dataUrl = canvas.toDataURL("image/png");
    return loadTexture(dataUrl, noMipmap);
  };
}

const DEBUG_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 100 100">` +
  `<rect x="0" y="0" width="100" height="100" fill="#fb8c00"/>` +
  `<circle cx="50" cy="50" r="30" fill="#fff" stroke="#bf360c" stroke-width="3"/>` +
  `<text x="50" y="58" font-family="sans-serif" font-size="20" text-anchor="middle" fill="#bf360c">SVG</text>` +
  `</svg>`;

function svgDataUrlFactory(noMipmap: boolean): () => Promise<Texture> {
  return () => {
    const base64 = btoa(DEBUG_SVG);
    const dataUrl = `data:image/svg+xml;base64,${base64}`;
    return loadTexture(dataUrl, noMipmap);
  };
}

function svgRasterizerFactory(): Promise<Texture> {
  // Same path the icon-provider uses in production, on a synthetic SVG.
  // If this fails but #5 (svgDataUrl) succeeds, the difference is the
  // rasteriser wrapper (logging, error handling) rather than the
  // underlying decode.
  return rasterizeSvgToTexture(DEBUG_SVG, 256);
}

async function loadTexture(url: string, noMipmap: boolean): Promise<Texture> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const source = new ImageSource({
    resource: img,
    alphaMode: "premultiply-alpha-on-upload",
    autoGenerateMipmaps: !noMipmap,
  });
  source.style = new TextureStyle({
    scaleMode: "linear",
    mipmapFilter: noMipmap ? "nearest" : "linear",
  });
  const tex = new Texture({ source });
  console.debug("[icon-debug] texture loaded", {
    size: { w: tex.width, h: tex.height },
    mipmaps: !noMipmap,
    urlPreview: url.slice(0, 60),
  });
  return tex;
}

// ── stories ────────────────────────────────────────────────────────

function shell(
  title: string,
  description: string,
  factory: (() => Texture | null | Promise<Texture | null>) | undefined,
  debug: boolean,
): TemplateResult {
  return html`
    <div class="om-story">
      <h3>${title}</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">${description}</p>
      <div class="om-story-canvas-host">
        <om-scene zoom="40" ?debug=${debug}>
          <om-grid-axis .extent=${500}></om-grid-axis>
          <om-debug-plane
            .x=${0}
            .y=${0}
            .size=${50}
            .textureFactory=${factory}
            .fallbackColor=${FALLBACK_RED}
          ></om-debug-plane>
        </om-scene>
      </div>
    </div>
  `;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/IconDebug",
  argTypes: {
    debug: { control: { type: "boolean" } },
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Baseline_NoTexture: Story = {
  args: { debug: false },
  render: ({ debug }) =>
    shell(
      "1. Baseline — no texture, red tint",
      "Should be a solid red square (Texture.WHITE tinted with fallbackColor). If it isn't, the failure is in scene/sprite — nothing downstream of this can work.",
      noTextureFactory,
      debug,
    ),
};

export const CanvasTexture_Procedural: Story = {
  args: { debug: false },
  render: ({ debug }) =>
    shell(
      "2. Canvas texture painted programmatically",
      "Blue square with a white circle and a red centre, drawn into a 2D canvas and uploaded via Texture.from(canvas). No <img>, no decode. If this fails the texture-binding pipeline itself is broken.",
      canvasTextureFactory,
      debug,
    ),
};

export const PngDataUrl_NoMipmap: Story = {
  args: { debug: false },
  render: ({ debug }) =>
    shell(
      "3. PNG data URL, no mipmaps",
      "Green square reading 'PNG'. PNG was produced via canvas.toDataURL → decoded into a Pixi Texture (linear, no mipmaps). Tests the PNG decoder.",
      pngDataUrlFactory(true),
      debug,
    ),
};

export const PngDataUrl_WithMipmap: Story = {
  args: { debug: false },
  render: ({ debug }) =>
    shell(
      "4. PNG data URL with mipmaps",
      "Same PNG as #3 but with mipmap generation. If #3 works but #4 doesn't, the mipmap path is the culprit.",
      pngDataUrlFactory(false),
      debug,
    ),
};

export const SvgDataUrl_NoMipmap: Story = {
  args: { debug: false },
  render: ({ debug }) =>
    shell(
      "5. SVG data URL, no mipmaps",
      "Orange square reading 'SVG'. SVG is base64-encoded into a data URL and decoded into a Pixi Texture (linear, no mipmaps). Tests the SVG decoder specifically.",
      svgDataUrlFactory(true),
      debug,
    ),
};

export const SvgDataUrl_WithMipmap: Story = {
  args: { debug: false },
  render: ({ debug }) =>
    shell(
      "6. SVG data URL with mipmaps",
      "Same SVG as #5 but with mipmap generation. Some browsers refuse to mipmap an SVG-decoded image. If #5 works and #6 doesn't, that's the issue.",
      svgDataUrlFactory(false),
      debug,
    ),
};

export const SvgViaRasterizer_NoMipmap: Story = {
  args: { debug: true },
  render: ({ debug }) =>
    shell(
      "7. SVG via production rasterizeSvgToTexture",
      "Same SVG as #5 but routed through the production icon-provider rasteriser. If #5 works but this doesn't, the rasteriser wrapper is the regression.",
      svgRasterizerFactory,
      debug,
    ),
};
