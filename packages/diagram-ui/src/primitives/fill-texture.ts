import { CanvasSource, Texture, TextureStyle, type Renderer } from "pixi.js";
import type { FillSpec, HatchSpec } from "@dicode/diagram-svg";
import { LruCache } from "../lru-cache.js";

/**
 * Bakes a renderer-neutral `FillSpec` (gradient or hatch) to a Pixi `Texture`
 * for the diagram-layer's native `Graphics` fills. Identical fills collapse to
 * one GPU texture via a per-renderer LRU.
 *
 * Gradients bake a `CanvasGradient` onto a square canvas mapped over the
 * shape's bbox. Hatches bake a small `spacing × spacing` tile drawn once and
 * tiled with `repeat` addressing, so the line density stays fixed in icon
 * units and crisp under zoom rather than stretching with the shape.
 *
 * Solid / none specs return `null` — the caller keeps its flat fill.
 */

const GRADIENT_TEXTURE_EDGE = 128;
/** Canvas pixels per icon unit for hatch tiles — enough that a 1-unit line is
 *  several texels wide and antialiases cleanly. */
const HATCH_PIXELS_PER_UNIT = 8;

/**
 * Maximum number of baked `Texture`s kept per-renderer. Each entry costs GPU
 * memory proportional to its canvas size, so this cap bounds diagrams with many
 * distinct hatch aspects (one cache key per aspect). Evicted textures are
 * deferred — not destroyed immediately — because live `Graphics` fills may
 * still reference them between renders; they are released by
 * {@link destroyFillTextureCache} on renderer teardown.
 */
export const FILL_TEXTURE_CACHE_CAPACITY = 256;

interface FillCache {
  lru: LruCache<string, Texture>;
  evicted: Texture[];
}

const caches = new WeakMap<Renderer, FillCache>();
/** Cache for the renderer-less (headless) path, where textures are built
 *  CPU-side without a GPU upload. */
let headlessCache: FillCache | null = null;

/**
 * Resolve (and cache) the baked fill texture for `spec`. Returns `null` for
 * `solid` / `none` specs, and when the canvas 2D context is unavailable.
 *
 * `aspect` (shape width / height) keys the hatch path so a tile baked for one
 * shape isn't reused at a different aspect. Gradients bake to a fixed square
 * and are aspect-independent, so they omit it and share one texture across
 * differently-proportioned shapes.
 */
export function resolveFillTexture(
  renderer: Renderer | null,
  spec: FillSpec,
  aspect: number,
): Texture | null {
  if (spec.kind === "solid" || spec.kind === "none") {
    return null;
  }
  const cache = ensureCache(renderer);
  const key = fillCacheKey(spec, aspect);
  const hit = cache.lru.get(key);
  if (hit) {
    return hit;
  }
  const texture = spec.kind === "hatch" ? bakeHatch(spec) : bakeGradient(spec);
  if (!texture) {
    return null;
  }
  cache.lru.set(key, texture);
  return texture;
}

/** Release every baked texture (cached + deferred-evicted) for `renderer`.
 *  Call on renderer teardown. */
export function destroyFillTextureCache(renderer: Renderer | null): void {
  const cache = renderer ? caches.get(renderer) : headlessCache;
  if (!cache) {
    return;
  }
  for (const tex of cache.lru.values()) {
    tex.destroy(true);
  }
  for (const tex of cache.evicted) {
    tex.destroy(true);
  }
  cache.lru.clear();
  cache.evicted.length = 0;
  if (renderer) {
    caches.delete(renderer);
  } else {
    headlessCache = null;
  }
}

function ensureCache(renderer: Renderer | null): FillCache {
  if (!renderer) {
    return (headlessCache ??= makeCache());
  }
  let cache = caches.get(renderer);
  if (!cache) {
    cache = makeCache();
    caches.set(renderer, cache);
  }
  return cache;
}

function makeCache(): FillCache {
  const evicted: Texture[] = [];
  const lru = new LruCache<string, Texture>(
    FILL_TEXTURE_CACHE_CAPACITY,
    (_key, tex) => evicted.push(tex),
  );
  return { lru, evicted };
}

export function fillCacheKey(
  spec: Exclude<FillSpec, { kind: "solid" } | { kind: "none" }>,
  aspect: number,
): string {
  if (spec.kind === "hatch") {
    const a = aspect.toFixed(3);
    return `hatch|${spec.direction}|${rgb(spec.line)}|${rgb(spec.background)}|${spec.spacing}|${spec.lineWidth}|${a}`;
  }
  const stops = spec.stops.map((s) => `${s.offset}:${rgb(s.color)}`).join(",");
  if (spec.kind === "radial-gradient") {
    return `radial|${spec.cx},${spec.cy},${spec.r}|${stops}`;
  }
  return `linear|${spec.x1},${spec.y1},${spec.x2},${spec.y2}|${stops}`;
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function textureFromCanvas(
  canvas: HTMLCanvasElement,
  repeat: boolean,
): Texture {
  const source = new CanvasSource({ resource: canvas });
  source.style = new TextureStyle({
    scaleMode: "linear",
    addressModeU: repeat ? "repeat" : "clamp-to-edge",
    addressModeV: repeat ? "repeat" : "clamp-to-edge",
  });
  return new Texture({ source });
}

function bakeGradient(spec: FillSpec): Texture | null {
  if (spec.kind !== "linear-gradient" && spec.kind !== "radial-gradient") {
    return null;
  }
  const size = GRADIENT_TEXTURE_EDGE;
  const canvas = makeCanvas(size, size);
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) {
    return null;
  }
  const gradient =
    spec.kind === "radial-gradient"
      ? ctx.createRadialGradient(
          spec.cx * size,
          spec.cy * size,
          0,
          spec.cx * size,
          spec.cy * size,
          spec.r * size,
        )
      : ctx.createLinearGradient(
          spec.x1 * size,
          spec.y1 * size,
          spec.x2 * size,
          spec.y2 * size,
        );
  for (const stop of spec.stops) {
    gradient.addColorStop(clamp01(stop.offset), rgb(stop.color));
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return textureFromCanvas(canvas, false);
}

function bakeHatch(spec: HatchSpec): Texture | null {
  const tile = Math.max(2, Math.round(spec.spacing * HATCH_PIXELS_PER_UNIT));
  const canvas = makeCanvas(tile, tile);
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) {
    return null;
  }
  ctx.fillStyle = rgb(spec.background);
  ctx.fillRect(0, 0, tile, tile);
  ctx.strokeStyle = rgb(spec.line);
  ctx.lineWidth = Math.max(1, spec.lineWidth * HATCH_PIXELS_PER_UNIT);
  ctx.beginPath();
  drawHatchLines(ctx, spec.direction, tile);
  ctx.stroke();
  return textureFromCanvas(canvas, true);
}

function drawHatchLines(
  ctx: CanvasRenderingContext2D,
  direction: HatchSpec["direction"],
  tile: number,
): void {
  const half = tile / 2;
  const seg = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  };
  switch (direction) {
    case "horizontal":
      seg(0, half, tile, half);
      break;
    case "vertical":
      seg(half, 0, half, tile);
      break;
    case "cross":
      seg(0, half, tile, half);
      seg(half, 0, half, tile);
      break;
    case "forward":
      seg(0, tile, tile, 0);
      break;
    case "backward":
      seg(0, 0, tile, tile);
      break;
    case "cross-diag":
      seg(0, tile, tile, 0);
      seg(0, 0, tile, tile);
      break;
  }
}

function rgb(color: readonly [number, number, number]): string {
  const [r, g, b] = color;
  return `rgb(${clampByte(r)},${clampByte(g)},${clampByte(b)})`;
}

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 255) return 255;
  return Math.round(n);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
