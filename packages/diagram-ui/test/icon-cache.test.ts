import { describe, expect, it, vi } from "vitest";
import { Texture } from "pixi.js";

import { IconCache } from "../src/icon-provider/icon-cache.js";
import type { IconLayer } from "@dicode/omc-client";

function makeLayers(svg: string): IconLayer[] {
  // Content doesn't matter — renderSvg is stubbed to return a fixed
  // string we control directly.
  return [{ from: `test:${svg}`, shapes: [] }];
}

describe("IconCache", () => {
  it("rasterises once per distinct SVG", async () => {
    const renderSvg = vi.fn((layers: IconLayer[]) => {
      const first = layers.at(0);
      return first !== undefined ? `svg:${first.from}` : "";
    });
    const rasterize = vi.fn(
      (): Promise<Texture> => Promise.resolve(new Texture()),
    );

    const cache = new IconCache(renderSvg, rasterize);
    const a1 = await cache.resolve({ layers: makeLayers("A") });
    const a2 = await cache.resolve({ layers: makeLayers("A") });
    const b = await cache.resolve({ layers: makeLayers("B") });

    expect(rasterize).toHaveBeenCalledTimes(2);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it("returns the same promise for concurrent identical requests", async () => {
    const renderSvg = vi.fn(() => `same-svg`);
    let resolveTex: ((t: Texture) => void) | undefined;
    const rasterize = vi.fn(
      (): Promise<Texture> =>
        new Promise<Texture>((res) => {
          resolveTex = (t) => res(t);
        }),
    );

    const cache = new IconCache(renderSvg, rasterize);
    const p1 = cache.resolve({ layers: makeLayers("X") });
    const p2 = cache.resolve({ layers: makeLayers("Y") });
    expect(rasterize).toHaveBeenCalledTimes(1);

    const tex = new Texture();
    if (resolveTex === undefined) throw new Error("rasterize was not invoked");
    resolveTex(tex);
    const a = await p1;
    const b = await p2;
    expect(a).toBe(b);
    expect(a).toBe(tex);
  });

  it("evicts failed entries so the next call retries", async () => {
    let calls = 0;
    const renderSvg = () => "svg";
    const rasterize = (): Promise<Texture> => {
      calls++;
      if (calls === 1) {
        return Promise.reject(new Error("boom"));
      }
      return Promise.resolve(new Texture());
    };

    const cache = new IconCache(renderSvg, rasterize);
    await expect(cache.resolve({ layers: makeLayers("Z") })).rejects.toThrow(
      "boom",
    );
    // Failure was evicted; second call retries and succeeds.
    const tex = await cache.resolve({ layers: makeLayers("Z") });
    expect(tex).toBeDefined();
    expect(calls).toBe(2);
  });

  it("uses the size hint as part of the cache key", async () => {
    const renderSvg = () => "svg";
    const rasterize = vi.fn(
      (): Promise<Texture> => Promise.resolve(new Texture()),
    );
    const cache = new IconCache(renderSvg, rasterize);
    await cache.resolve({ layers: makeLayers("S"), size: 128 });
    await cache.resolve({ layers: makeLayers("S"), size: 256 });
    expect(rasterize).toHaveBeenCalledTimes(2);
  });

  it("evicts and destroys the LRU texture when capacity is exceeded", async () => {
    const destroyed: string[] = [];
    const renderSvg = vi.fn((layers: IconLayer[]) => {
      const first = layers.at(0);
      return first !== undefined ? `svg:${first.from}` : "";
    });
    const rasterize = vi.fn((svg: string): Promise<Texture> => {
      const tex = new Texture();
      const origDestroy = tex.destroy.bind(tex);
      tex.destroy = (destroySource?: boolean) => {
        destroyed.push(svg);
        origDestroy(destroySource);
      };
      return Promise.resolve(tex);
    });

    // Capacity 2 — adding a third entry evicts the LRU.
    const cache = new IconCache(renderSvg, rasterize, 2);
    await cache.resolve({ layers: makeLayers("A") });
    await cache.resolve({ layers: makeLayers("B") });
    expect(cache.size).toBe(2);

    // "A" is LRU; adding "C" must evict and destroy its texture.
    await cache.resolve({ layers: makeLayers("C") });
    expect(cache.size).toBe(2);
    expect(destroyed).toEqual(["svg:test:A"]);

    // "A" is gone; re-resolving it should rasterise again.
    await cache.resolve({ layers: makeLayers("A") });
    expect(rasterize).toHaveBeenCalledTimes(4);
  });
});
