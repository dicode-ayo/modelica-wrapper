/**
 * Diagnostic ladder for the icon texture pipeline. Each story
 * renders ONE textured plane and isolates a single stage of the
 * chain, so a regression is bisected at a glance:
 *
 *   1. `Baseline_NoTexture`
 *      Plane + StandardMaterial with `emissiveColor = red`, no
 *      texture. If this *doesn't* show red → scene/camera/mesh
 *      pipeline is broken (everything below depends on this).
 *
 *   2. `DynamicTexture_Procedural`
 *      Plane with a Babylon `DynamicTexture` painted directly via
 *      its 2D canvas context (red square + blue circle). If this
 *      shows but #1 didn't → texture binding works in isolation.
 *      If #2 fails → DynamicTexture → mesh material pipeline is
 *      broken.
 *
 *   3. `PngDataUrl_NoMipmap`
 *      Plane with a Babylon `Texture` loaded from a
 *      `canvas.toDataURL("image/png")` data URL, no mipmaps. Tests
 *      the browser's PNG decoder + Babylon's image loader.
 *
 *   4. `PngDataUrl_WithMipmap`
 *      Same PNG but with `noMipmap = false`. Tests Babylon's mipmap
 *      generation. If #3 works but #4 doesn't → mipmap chain is the
 *      culprit (e.g., NPOT texture issue, sampling mode mismatch).
 *
 *   5. `SvgDataUrl_NoMipmap`
 *      Plane with a Babylon `Texture` loaded from a base64 SVG data
 *      URL — the current production rasteriser path. Tests the SVG
 *      decoder specifically. If #3 works but #5 doesn't → SVG decode
 *      is the bug.
 *
 *   6. `SvgDataUrl_WithMipmap`
 *      Same as #5 with mipmap generation enabled. Some browsers
 *      refuse to mipmap an SVG-decoded image.
 *
 * Open the browser console with each story — when `debug=true` the
 * rasteriser logs `[diagram-ui] SVG texture ready { ... }` on
 * success and `[diagram-ui] SVG → Texture load failed` on failure.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import {
  Color3,
  DynamicTexture,
  Texture,
  type Scene,
} from "@babylonjs/core";

import "../src/scene/scene.component.js";
import "../src/axis/grid-axis.component.js";
import "../src/debug/debug-plane.component.js";
import { rasterizeSvgToTexture } from "../src/icon-provider/svg-rasterizer.js";

interface StoryArgs {
  debug: boolean;
}

// ── factories ──────────────────────────────────────────────────────

function noTextureFactory(): null {
  return null;
}

function dynamicTextureFactory(scene: Scene): Texture {
  // 256×256 canvas painted programmatically. Bypasses every loader:
  // no <img>, no PNG/SVG decode, no network. If the plane stays
  // magenta or red here, the DynamicTexture → GPU upload path is
  // broken.
  const size = 256;
  const dt = new DynamicTexture(
    "debug-dynamic",
    { width: size, height: size },
    scene,
    false /* generateMipMaps */,
    Texture.BILINEAR_SAMPLINGMODE,
  );
  const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
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
  dt.update(false);
  dt.hasAlpha = true;
  return dt;
}

function pngDataUrlFactory(noMipmap: boolean): (scene: Scene) => Promise<Texture> {
  return (scene) => {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#43a047"; // green
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 80px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("PNG", size / 2, size / 2);
    const dataUrl = canvas.toDataURL("image/png");
    return loadTexture(dataUrl, scene, noMipmap);
  };
}

const DEBUG_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 100 100">` +
  `<rect x="0" y="0" width="100" height="100" fill="#fb8c00"/>` +
  `<circle cx="50" cy="50" r="30" fill="#fff" stroke="#bf360c" stroke-width="3"/>` +
  `<text x="50" y="58" font-family="sans-serif" font-size="20" text-anchor="middle" fill="#bf360c">SVG</text>` +
  `</svg>`;

function svgDataUrlFactory(noMipmap: boolean): (scene: Scene) => Promise<Texture> {
  return (scene) => {
    const base64 = btoa(DEBUG_SVG);
    const dataUrl = `data:image/svg+xml;base64,${base64}`;
    return loadTexture(dataUrl, scene, noMipmap);
  };
}

function svgRasterizerFactory(scene: Scene): Promise<Texture> {
  // Same path the icon-provider uses in production, on a synthetic
  // SVG. If this fails but #5 (svgDataUrl) succeeds, the difference
  // is the rasteriser wrapper (logging, error handling) rather than
  // the underlying loader.
  return rasterizeSvgToTexture(DEBUG_SVG, scene, 256);
}

function loadTexture(
  url: string,
  scene: Scene,
  noMipmap: boolean,
): Promise<Texture> {
  return new Promise<Texture>((resolve, reject) => {
    const tex: Texture = new Texture(
      url,
      scene,
      noMipmap,
      true /* invertY */,
      noMipmap
        ? Texture.BILINEAR_SAMPLINGMODE
        : Texture.TRILINEAR_SAMPLINGMODE,
      () => {
        tex.hasAlpha = true;
        // eslint-disable-next-line no-console
        console.debug("[icon-debug] texture loaded", {
          size: tex.getSize(),
          hasAlpha: tex.hasAlpha,
          urlPreview: url.slice(0, 60),
        });
        resolve(tex);
      },
      (message, exception) => {
        // eslint-disable-next-line no-console
        console.error("[icon-debug] texture failed", message, exception);
        reject(new Error(message ?? "load error"));
      },
    );
  });
}

// ── stories ────────────────────────────────────────────────────────

function shell(
  title: string,
  description: string,
  factory:
    | ((scene: Scene) => Texture | null | Promise<Texture | null>)
    | undefined,
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
            .fallbackColor=${new Color3(0.85, 0.2, 0.2)}
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
      "1. Baseline — no texture, emissive red",
      "Should be a solid red square. If it isn't, the failure is in scene/camera/mesh/material — nothing downstream of this can work.",
      noTextureFactory,
      debug,
    ),
};

export const DynamicTexture_Procedural: Story = {
  args: { debug: false },
  render: ({ debug }) =>
    shell(
      "2. DynamicTexture painted programmatically",
      "Blue square with a white circle and a red centre, all drawn into a Babylon DynamicTexture's canvas. No <img>, no decode. If this fails the texture-binding pipeline itself is broken.",
      dynamicTextureFactory,
      debug,
    ),
};

export const PngDataUrl_NoMipmap: Story = {
  args: { debug: false },
  render: ({ debug }) =>
    shell(
      "3. PNG data URL, no mipmaps",
      "Green square reading 'PNG'. PNG was produced via canvas.toDataURL → loaded into Babylon Texture (BILINEAR, no mipmaps). Tests the PNG decoder.",
      pngDataUrlFactory(true),
      debug,
    ),
};

export const PngDataUrl_WithMipmap: Story = {
  args: { debug: false },
  render: ({ debug }) =>
    shell(
      "4. PNG data URL with mipmaps",
      "Same PNG as #3 but with mipmap generation + TRILINEAR sampling. If #3 works but #4 doesn't, the mipmap path is the culprit.",
      pngDataUrlFactory(false),
      debug,
    ),
};

export const SvgDataUrl_NoMipmap: Story = {
  args: { debug: false },
  render: ({ debug }) =>
    shell(
      "5. SVG data URL, no mipmaps",
      "Orange square reading 'SVG'. SVG is base64-encoded into a data URL and loaded straight into a Babylon Texture (BILINEAR). Tests the SVG decoder specifically.",
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
