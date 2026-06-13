import {
  DynamicTexture,
  Texture,
  type Scene,
  type BaseTexture,
} from "@babylonjs/core";
import type { FillSpec, HatchSpec } from "@dicode/diagram-svg";
import { LruCache } from "../lru-cache.js";

/**
 * Bakes a renderer-neutral `FillSpec` (gradient or hatch) to a Babylon
 * `DynamicTexture` for the diagram-layer's native meshes. Mirrors the
 * `<om-text>` DynamicTexture pattern and the icon-cache's per-scene
 * deduplication: identical fills collapse to one GPU texture.
 *
 * Gradients bake a `CanvasGradient` onto a square canvas mapped over the
 * shape's UVs. Hatches bake a small `spacing × spacing` tile drawn once and
 * tiled with `WRAP` addressing, so the line density stays fixed in icon units
 * and crisp under zoom rather than stretching with the shape.
 *
 * Solid / none specs return `null` — the caller keeps its flat material.
 */

const GRADIENT_TEXTURE_EDGE = 128;
/** Canvas pixels per icon unit for hatch tiles — enough that a 1-unit line is
 *  several texels wide and antialiases cleanly. */
const HATCH_PIXELS_PER_UNIT = 8;

/**
 * Maximum number of baked `DynamicTexture`s kept in the scene-level LRU. Each
 * entry costs GPU memory proportional to its canvas size, so this cap bounds
 * diagrams with many distinct hatch aspects (one cache key per aspect). Evicted
 * textures are deferred until scene teardown — not disposed immediately —
 * because mesh materials may still reference them between renders.
 */
export const FILL_TEXTURE_CACHE_CAPACITY = 256;

const SCENE_META_KEY = "omFillTextureCache";

interface SceneMeta {
  [SCENE_META_KEY]?: LruCache<string, DynamicTexture> | undefined;
}

/**
 * Resolve (and cache) the baked fill texture for `spec`. Returns `null` for
 * `solid` / `none` specs, and when the canvas 2D context is unavailable.
 *
 * `aspect` (mesh width / height) keys the hatch path so a tile baked for one
 * shape isn't reused at a different aspect. Gradients bake to a fixed square
 * and are aspect-independent, so they omit it and share one texture across
 * differently-proportioned shapes.
 */
export function resolveFillTexture(
  scene: Scene,
  spec: FillSpec,
  aspect: number,
): BaseTexture | null {
  if (spec.kind === "solid" || spec.kind === "none") {
    return null;
  }
  const cache = ensureCache(scene);
  const key = fillCacheKey(spec, aspect);
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }
  const texture =
    spec.kind === "hatch" ? bakeHatch(scene, spec) : bakeGradient(scene, spec);
  if (!texture) {
    return null;
  }
  cache.set(key, texture);
  return texture;
}

function ensureCache(scene: Scene): LruCache<string, DynamicTexture> {
  const metadata = (scene.metadata as SceneMeta | null | undefined) ?? {};
  const existing = metadata[SCENE_META_KEY];
  if (existing) {
    return existing;
  }
  // Textures evicted from the LRU are still referenced by mesh materials, so
  // we defer disposal to scene teardown rather than disposing immediately.
  const evictedPending: DynamicTexture[] = [];
  const cache = new LruCache<string, DynamicTexture>(
    FILL_TEXTURE_CACHE_CAPACITY,
    (_key, tex) => evictedPending.push(tex),
  );
  metadata[SCENE_META_KEY] = cache;
  scene.metadata = metadata;
  scene.onDisposeObservable.add(() => {
    for (const tex of cache.values()) {
      tex.dispose();
    }
    for (const tex of evictedPending) {
      tex.dispose();
    }
    cache.clear();
    metadata[SCENE_META_KEY] = undefined;
  });
  return cache;
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

function bakeGradient(scene: Scene, spec: FillSpec): DynamicTexture | null {
  if (spec.kind !== "linear-gradient" && spec.kind !== "radial-gradient") {
    return null;
  }
  const size = GRADIENT_TEXTURE_EDGE;
  const texture = new DynamicTexture(
    "om-fill.gradient",
    { width: size, height: size },
    scene,
    true,
  );
  const ctx = texture.getContext() as CanvasRenderingContext2D | null;
  if (!ctx) {
    texture.dispose();
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
  texture.update();
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

function bakeHatch(scene: Scene, spec: HatchSpec): DynamicTexture | null {
  const tile = Math.max(2, Math.round(spec.spacing * HATCH_PIXELS_PER_UNIT));
  const texture = new DynamicTexture(
    "om-fill.hatch",
    { width: tile, height: tile },
    scene,
    true,
  );
  const ctx = texture.getContext() as CanvasRenderingContext2D | null;
  if (!ctx) {
    texture.dispose();
    return null;
  }
  ctx.fillStyle = rgb(spec.background);
  ctx.fillRect(0, 0, tile, tile);
  ctx.strokeStyle = rgb(spec.line);
  ctx.lineWidth = Math.max(1, spec.lineWidth * HATCH_PIXELS_PER_UNIT);
  ctx.beginPath();
  drawHatchLines(ctx, spec.direction, tile);
  ctx.stroke();
  texture.update();
  // WRAP so the small tile repeats over the shape's UVs at a fixed icon-unit
  // density rather than stretching to fill.
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
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
