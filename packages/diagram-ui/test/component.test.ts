import { afterEach, describe, expect, it } from "vitest";
import { NullEngine, Texture, type Scene } from "@babylonjs/core";
import type { IconLayer, Placement } from "@dicode/omc-client";

import "../src/scene/scene.component.js";
import "../src/icon-provider/icon-provider.component.js";
import "../src/component/component.component.js";
import type { OmScene } from "../src/scene/scene.component.js";
import type { OmIconProvider } from "../src/icon-provider/icon-provider.component.js";
import type { OmComponent } from "../src/component/component.component.js";

function makeNullEngine(): NullEngine {
  return new NullEngine({
    renderWidth: 320,
    renderHeight: 240,
    textureSize: 256,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
}

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
  provider.renderSvg = (layers) => `svg:${layers[0]!.from}`;
  provider.rasterize = (svg: string, scene: Scene): Promise<Texture> =>
    Promise.resolve(new Texture(`data:text/plain,${svg}`, scene, true, false));
  const scene = document.createElement("om-scene") as OmScene;
  scene.engineFactory = () => makeNullEngine();
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
    comp.placement = { extent: [[-10, -10], [10, 10]] } as Placement;
    comp.layers = [{ from: "TestClass", shapes: [] }] as IconLayer[];
    scene.appendChild(comp);
    await comp.updateComplete;
    // Wait a tick for the iconProvider promise to resolve and apply.
    await new Promise((r) => setTimeout(r, 0));
    expect(comp).toBeDefined();
    const transform = scene.sceneContextValue!.diagramRoot;
    // The component's TransformNode is a child of diagramRoot.
    expect(transform.getChildTransformNodes(true).length).toBeGreaterThan(0);
  });

  it("applies placement to the shape node's TransformNode", async () => {
    const { scene } = await mountChain();
    const comp = document.createElement("om-component") as OmComponent;
    comp.placement = { extent: [[20, 30], [40, 50]] } as Placement;
    scene.appendChild(comp);
    await comp.updateComplete;
    // First child TransformNode after diagramRoot.
    const child = scene.sceneContextValue!.diagramRoot.getChildTransformNodes(
      true,
    )[0]!;
    expect(child.position.x).toBe(30);
    expect(child.position.y).toBe(40);
  });
});
