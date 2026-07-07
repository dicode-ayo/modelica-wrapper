import type { CoordinateSystem, IconLayer } from "@dicode/omc-client";
import type { Texture } from "pixi.js";
import { LruCache } from "../lru-cache.js";

/**
 * Renderer-agnostic icon cache used by `<om-icon-provider>`. The cache
 * resolves `IconLayer[]` (plus an optional coordinate system) to a Pixi
 * `Texture` via two injectable steps:
 *
 *   1. `renderSvg(layers, coordinateSystem) -> string` — typically
 *      `renderIconLayersToSvg` from `@dicode/diagram-svg`.
 *   2. `rasterize(svg, size) -> Texture` — turns the SVG string into a
 *      Pixi Texture; the production implementation lives in
 *      `svg-rasterizer.ts`, tests inject a stub.
 *
 * The cache key is the SVG string (prefixed by `size`): identical icon
 * shapes hash deterministically through the SVG renderer, so we get free
 * deduplication across components that reference the same class.
 *
 * Textures are returned as Promises because rasterisation involves
 * `<img>` decoding in the browser. Once resolved, the Promise is held in
 * the cache so subsequent calls return immediately. SVG decode needs no
 * live renderer, so `resolve` takes no scene/renderer handle.
 */

export interface IconRequest {
  layers: IconLayer[];
  coordinateSystem?: CoordinateSystem | undefined;
  /** Pixel size used by the rasteriser; controls texture resolution. */
  size?: number;
}

export type SvgRenderFn = (
  layers: IconLayer[],
  coordinateSystem: CoordinateSystem | undefined,
) => string;

export type RasterizeFn = (svg: string, size: number) => Promise<Texture>;

const DEFAULT_TEXTURE_SIZE = 512;

/**
 * Maximum number of icon textures kept alive per `IconCache` instance. Each
 * entry is one rasterised GPU texture. A real diagram rarely exceeds a few
 * dozen distinct component classes, so 512 is a conservative ceiling.
 * Evicted textures are destroyed after their Promise resolves; any sprite
 * still referencing one degrades to untextured until its
 * `<om-icon-provider>` re-resolves on the next render.
 */
export const ICON_CACHE_CAPACITY = 512;

export class IconCache {
  private readonly cache: LruCache<string, Promise<Texture>>;

  constructor(
    private readonly renderSvg: SvgRenderFn,
    private readonly rasterize: RasterizeFn,
    capacity = ICON_CACHE_CAPACITY,
  ) {
    this.cache = new LruCache(capacity, (_key, promise) => {
      // Async: the promise may still be pending when eviction fires. The
      // `.catch` suppresses rasterisation failures that already have a handler
      // in `resolve()` — this path only needs to ensure a resolved texture is
      // destroyed and does not propagate errors further.
      promise.then((tex) => tex.destroy(true)).catch(() => {});
    });
  }

  resolve(req: IconRequest): Promise<Texture> {
    const size = req.size ?? DEFAULT_TEXTURE_SIZE;
    const svg = this.renderSvg(req.layers, req.coordinateSystem);
    const key = `${size}|${svg}`;
    const hit = this.cache.get(key);
    if (hit) {
      return hit;
    }
    const promise = this.rasterize(svg, size);
    this.cache.set(key, promise);
    promise.catch(() => {
      // Drop failed entries so a retry actually retries.
      this.cache.delete(key);
    });
    return promise;
  }

  /** Number of cache entries (for tests / metrics). */
  get size(): number {
    return this.cache.size;
  }

  /** Destroys every resolved texture and clears the cache. */
  async destroy(): Promise<void> {
    const promises = Array.from(this.cache.values());
    this.cache.clear();
    for (const p of promises) {
      try {
        const tex = await p;
        tex.destroy(true);
      } catch {
        // already errored; nothing to destroy
      }
    }
  }
}
