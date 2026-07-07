import { afterEach, describe, expect, it } from "vitest";
import { Texture } from "pixi.js";

import "../src/scene/scene.component.js";
import "../src/icon-provider/icon-provider.component.js";
import type { OmScene } from "../src/scene/scene.component.js";
import type { OmIconProvider } from "../src/icon-provider/icon-provider.component.js";
import type { IconLayer } from "@dicode/omc-client";

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

  it("resolves identical layers to the same texture via the cache", async () => {
    const provider = document.createElement(
      "om-icon-provider",
    ) as OmIconProvider;
    provider.renderSvg = (layers) => {
      const first = layers.at(0);
      if (first === undefined) throw new Error("expected at least one layer");
      return `svg:${first.from}`;
    };
    provider.rasterize = (): Promise<Texture> => Promise.resolve(new Texture());
    const scene = document.createElement("om-scene") as OmScene;
    // Renderer-less: build the Pixi scene graph on the CPU, no GPU context.
    scene.rendererFactory = () => null;
    provider.appendChild(scene);
    document.body.appendChild(provider);
    mounted.push(provider);
    await provider.updateComplete;
    await scene.updateComplete;

    const cache = provider.iconCache;
    if (!cache) throw new Error("expected iconCache");
    const layersA: IconLayer[] = [{ from: "A", shapes: [] }];
    const layersB: IconLayer[] = [{ from: "B", shapes: [] }];
    const a1 = await cache.resolve({ layers: layersA });
    const a2 = await cache.resolve({ layers: layersA });
    const b = await cache.resolve({ layers: layersB });
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it("destroys the cache when removed from the DOM", async () => {
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
