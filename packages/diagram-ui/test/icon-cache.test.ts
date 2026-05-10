import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine, Scene, Texture } from "@babylonjs/core";

import { IconCache } from "../src/icon-provider/icon-cache.js";
import type { IconLayer } from "@modelica-wrapper/omc-client";

function makeScene(): { scene: Scene; dispose: () => void } {
  const engine = new NullEngine({
    renderWidth: 256,
    renderHeight: 256,
    textureSize: 256,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  const scene = new Scene(engine);
  return {
    scene,
    dispose: () => {
      scene.dispose();
      engine.dispose();
    },
  };
}

function makeLayers(svg: string): IconLayer[] {
  // Content doesn't matter — renderSvg is stubbed to return a fixed
  // string we control directly.
  return [{ from: `test:${svg}`, shapes: [] }];
}

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) {
    t();
  }
});

describe("IconCache", () => {
  it("rasterises once per distinct SVG", async () => {
    const { scene, dispose } = makeScene();
    teardowns.push(dispose);

    const renderSvg = vi.fn((layers: IconLayer[]) => `svg:${layers[0]!.from}`);
    const rasterize = vi.fn(
      (svg: string, s: Scene, size: number): Promise<Texture> =>
        Promise.resolve(
          new Texture(`data:text/plain,${svg}:${size}`, s, true, false),
        ),
    );

    const cache = new IconCache(renderSvg, rasterize);
    const a1 = await cache.resolve(scene, { layers: makeLayers("A") });
    const a2 = await cache.resolve(scene, { layers: makeLayers("A") });
    const b = await cache.resolve(scene, { layers: makeLayers("B") });

    expect(rasterize).toHaveBeenCalledTimes(2);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it("returns the same promise for concurrent identical requests", async () => {
    const { scene, dispose } = makeScene();
    teardowns.push(dispose);

    const renderSvg = vi.fn(() => `same-svg`);
    let resolveTex: ((t: Texture) => void) | undefined;
    const rasterize = vi.fn(
      (): Promise<Texture> =>
        new Promise<Texture>((res) => {
          resolveTex = (t) => res(t);
        }),
    );

    const cache = new IconCache(renderSvg, rasterize);
    const p1 = cache.resolve(scene, { layers: makeLayers("X") });
    const p2 = cache.resolve(scene, { layers: makeLayers("Y") });
    expect(rasterize).toHaveBeenCalledTimes(1);

    const tex = new Texture("data:text/plain,same", scene, true, false);
    resolveTex!(tex);
    const a = await p1;
    const b = await p2;
    expect(a).toBe(b);
    expect(a).toBe(tex);
  });

  it("evicts failed entries so the next call retries", async () => {
    const { scene, dispose } = makeScene();
    teardowns.push(dispose);

    let calls = 0;
    const renderSvg = () => "svg";
    const rasterize: (svg: string, s: Scene) => Promise<Texture> = (svg, s) => {
      calls++;
      if (calls === 1) {
        return Promise.reject(new Error("boom"));
      }
      return Promise.resolve(new Texture(`data:text/plain,${svg}`, s, true, false));
    };

    const cache = new IconCache(renderSvg, rasterize);
    await expect(cache.resolve(scene, { layers: makeLayers("Z") })).rejects.toThrow(
      "boom",
    );
    // Failure was evicted; second call retries and succeeds.
    const tex = await cache.resolve(scene, { layers: makeLayers("Z") });
    expect(tex).toBeDefined();
    expect(calls).toBe(2);
  });

  it("uses the size hint as part of the cache key", async () => {
    const { scene, dispose } = makeScene();
    teardowns.push(dispose);

    const renderSvg = () => "svg";
    const rasterize = vi.fn(
      (_svg: string, s: Scene): Promise<Texture> =>
        Promise.resolve(new Texture("data:text/plain,a", s, true, false)),
    );
    const cache = new IconCache(renderSvg, rasterize);
    await cache.resolve(scene, { layers: makeLayers("S"), size: 128 });
    await cache.resolve(scene, { layers: makeLayers("S"), size: 256 });
    expect(rasterize).toHaveBeenCalledTimes(2);
  });
});
