import { afterEach, describe, expect, it } from "vitest";
import { NullEngine, Texture, type Scene } from "@babylonjs/core";

import "../src/scene/scene.component.js";
import "../src/icon-provider/icon-provider.component.js";
import type { OmScene } from "../src/scene/scene.component.js";
import type { OmIconProvider } from "../src/icon-provider/icon-provider.component.js";
import type { IconLayer } from "@dicode/omc-client";

function makeNullEngine(): NullEngine {
  return new NullEngine({
    renderWidth: 320,
    renderHeight: 240,
    textureSize: 256,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
}

let mounted: HTMLElement[] = [];

afterEach(() => {
  for (const el of mounted) {
    el.remove();
  }
  mounted = [];
});

describe("<om-icon-provider>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("om-icon-provider")).toBeDefined();
  });

  it("resolves identical layers to the same texture via the context", async () => {
    const provider = document.createElement(
      "om-icon-provider",
    ) as OmIconProvider;
    provider.renderSvg = (layers) => {
      const first = layers.at(0);
      if (first === undefined) throw new Error("expected at least one layer");
      return `svg:${first.from}`;
    };
    provider.rasterize = (svg: string, scene: Scene): Promise<Texture> =>
      Promise.resolve(
        new Texture(`data:text/plain,${svg}`, scene, true, false),
      );
    const scene = document.createElement("om-scene") as OmScene;
    scene.engineFactory = () => makeNullEngine();
    provider.appendChild(scene);
    document.body.appendChild(provider);
    mounted.push(provider);
    await provider.updateComplete;
    await scene.updateComplete;

    const cache = provider.iconCache;
    if (!cache) throw new Error("expected iconCache");
    const layersA: IconLayer[] = [{ from: "A", shapes: [] }];
    const layersB: IconLayer[] = [{ from: "B", shapes: [] }];
    const ctx = scene.sceneContextValue;
    if (!ctx) throw new Error("no scene context");
    const a1 = await cache.resolve(ctx.scene, {
      layers: layersA,
    });
    const a2 = await cache.resolve(ctx.scene, {
      layers: layersA,
    });
    const b = await cache.resolve(ctx.scene, {
      layers: layersB,
    });
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it("disposes the cache when removed from the DOM", async () => {
    const provider = document.createElement(
      "om-icon-provider",
    ) as OmIconProvider;
    document.body.appendChild(provider);
    mounted.push(provider);
    await provider.updateComplete;
    expect(provider.iconCache).not.toBeNull();
    provider.remove();
    expect(provider.iconCache).toBeNull();
  });
});
