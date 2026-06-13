import type { CoordinateSystem, IconLayer } from "@dicode/omc-client";
import type { Scene, Texture } from "@babylonjs/core";
import { LruCache } from "../lru-cache.js";

/**
 * Renderer-agnostic icon cache used by `<om-icon-provider>`. The cache
 * resolves `IconLayer[]` (plus an optional coordinate system) to a
 * Babylon `Texture` via two injectable steps:
 *
 *   1. `renderSvg(layers, coordinateSystem) -> string` — typically
 *      `renderIconLayersToSvg` from `@dicode/diagram-svg`.
 *   2. `rasterize(svg, scene, size) -> Texture` — turns the SVG string
 *      into a Babylon Texture; the production implementation lives in
 *      `svg-rasterizer.ts`, tests inject a stub.
 *
 * The cache key is the SVG string itself: identical icon shapes hash
 * deterministically through the SVG renderer, so we get free
 * deduplication across components that reference the same class.
 *
 * Textures are returned as Promises because rasterisation involves
 * `<img>` loading in the browser. Once resolved, the Promise is held
 * in the cache so subsequent calls return immediately.
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

export type RasterizeFn = (
  svg: string,
  scene: Scene,
  size: number,
) => Promise<Texture>;

const DEFAULT_TEXTURE_SIZE = 512;

/**
 * Maximum number of icon textures kept alive per `IconCache` instance. Each
 * entry is one rasterised GPU texture. A real diagram rarely exceeds a few
 * dozen distinct component classes, so 512 is a conservative ceiling.
 * Evicted textures are disposed after their Promise resolves; any mesh
 * material still referencing one degrades to untextured until its
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
      promise.then((tex) => tex.dispose()).catch(() => {});
    });
  }

  resolve(scene: Scene, req: IconRequest): Promise<Texture> {
    const size = req.size ?? DEFAULT_TEXTURE_SIZE;
    const svg = this.renderSvg(req.layers, req.coordinateSystem);
    const key = `${size}|${svg}`;
    const hit = this.cache.get(key);
    if (hit) {
      return hit;
    }
    const promise = this.rasterize(svg, scene, size);
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

  /** Disposes every resolved texture and clears the cache. */
  async destroy(): Promise<void> {
    const promises = Array.from(this.cache.values());
    this.cache.clear();
    for (const p of promises) {
      try {
        const tex = await p;
        tex.dispose();
      } catch {
        // already errored; nothing to dispose
      }
    }
  }
}
