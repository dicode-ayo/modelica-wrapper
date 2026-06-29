import { afterEach, describe, expect, it } from "vitest";
import { Texture } from "pixi.js";
import type { IconLayer, Placement } from "@dicode/omc-client";

import "../src/scene/scene.component.js";
import "../src/icon-provider/icon-provider.component.js";
import "../src/component/component.component.js";
import type { OmScene } from "../src/scene/scene.component.js";
import type { OmIconProvider } from "../src/icon-provider/icon-provider.component.js";
import type { OmComponent } from "../src/component/component.component.js";

const teardowns: Array<() => void> = [];

afterEach(() => {
  for (const t of teardowns.splice(0)) {
    t();
  }
});

async function mountChain(): Promise<{
  provider: OmIconProvider;
  scene: OmScene;
}> {
  const provider = document.createElement("om-icon-provider") as OmIconProvider;
  provider.renderSvg = (layers) => {
    const first = layers.at(0);
    if (first === undefined) throw new Error("expected at least one layer");
    return `svg:${first.from}`;
  };
  provider.rasterize = (_svg: string): Promise<Texture> =>
    Promise.resolve(Texture.EMPTY);
  const scene = document.createElement("om-scene") as OmScene;
  scene.rendererFactory = () => null;
  provider.appendChild(scene);
  document.body.appendChild(provider);
  teardowns.push(() => provider.remove());
  await provider.updateComplete;
  await scene.updateComplete;
  return { provider, scene };
}

describe("<om-component>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("om-component")).toBeDefined();
  });

  it("creates a shape node parented to the diagram root once mounted", async () => {
    const { scene } = await mountChain();
    const comp = document.createElement("om-component") as OmComponent;
    comp.nodeId = "R1";
    comp.placement = {
      extent: [
        [-10, -10],
        [10, 10],
      ],
    } as Placement;
    comp.layers = [{ from: "TestClass", shapes: [] }] as IconLayer[];
    scene.appendChild(comp);
    await comp.updateComplete;
    // Wait a tick for the iconProvider promise to resolve and apply.
    await new Promise((r) => setTimeout(r, 0));
    expect(comp).toBeDefined();
    const ctx = scene.sceneContextValue;
    if (!ctx) throw new Error("no scene context");
    // The component's entity Container is a child of diagramRoot.
    expect(ctx.diagramRoot.children.length).toBeGreaterThan(0);
  });

  it("applies placement to the shape node's container", async () => {
    const { scene } = await mountChain();
    const comp = document.createElement("om-component") as OmComponent;
    comp.placement = {
      extent: [
        [20, 30],
        [40, 50],
      ],
    } as Placement;
    scene.appendChild(comp);
    await comp.updateComplete;
    // First child Container under diagramRoot.
    const ctx = scene.sceneContextValue;
    if (!ctx) throw new Error("no scene context");
    const child = ctx.diagramRoot.children.at(0);
    if (!child) throw new Error("expected child container");
    expect(child.position.x).toBe(30);
    expect(child.position.y).toBe(40);
  });
});
