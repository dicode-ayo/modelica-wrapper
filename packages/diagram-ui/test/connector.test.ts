import { afterEach, describe, expect, it } from "vitest";
import { NullEngine, Texture, type Scene } from "@babylonjs/core";
import type { IconLayer, Placement } from "@dicode/omc-client";

import "../src/scene/scene.component.js";
import "../src/icon-provider/icon-provider.component.js";
import "../src/component/component.component.js";
import "../src/connector/connector.component.js";
import type { OmScene } from "../src/scene/scene.component.js";
import type { OmIconProvider } from "../src/icon-provider/icon-provider.component.js";
import type { OmComponent } from "../src/component/component.component.js";
import type { OmConnector } from "../src/connector/connector.component.js";

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

async function mountScene(): Promise<{ scene: OmScene; provider: OmIconProvider }> {
  const provider = document.createElement("om-icon-provider") as OmIconProvider;
  provider.renderSvg = (l) => `svg:${l[0]!.from}`;
  provider.rasterize = (svg: string, s: Scene): Promise<Texture> =>
    Promise.resolve(new Texture(`data:text/plain,${svg}`, s, true, false));
  const scene = document.createElement("om-scene") as OmScene;
  scene.engineFactory = () => makeNullEngine();
  provider.appendChild(scene);
  document.body.appendChild(provider);
  teardowns.push(() => provider.remove());
  await provider.updateComplete;
  await scene.updateComplete;
  return { scene, provider };
}

describe("<om-connector>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("om-connector")).toBeDefined();
  });

  it("creates a port-indicator disc that is initially hidden", async () => {
    const { scene } = await mountScene();
    const conn = document.createElement("om-connector") as OmConnector;
    conn.nodeId = "p";
    conn.placement = { extent: [[-5, -5], [5, 5]] } as Placement;
    conn.layers = [{ from: "C", shapes: [] }] as IconLayer[];
    scene.appendChild(conn);
    await conn.updateComplete;
    expect(conn.portIndicatorVisible).toBe(false);
  });

  it("attaches the port indicator under the connector's TransformNode", async () => {
    const { scene } = await mountScene();
    const conn = document.createElement("om-connector") as OmConnector;
    conn.placement = { extent: [[-5, -5], [5, 5]] } as Placement;
    scene.appendChild(conn);
    await conn.updateComplete;
    conn.setPortIndicatorVisible(true);
    expect(conn.portIndicatorVisible).toBe(true);
  });

  it("nested connector inherits the parent component's TransformNode as its parent", async () => {
    const { scene } = await mountScene();
    const comp = document.createElement("om-component") as OmComponent;
    comp.nodeId = "block";
    comp.placement = { extent: [[-20, -20], [20, 20]] } as Placement;
    scene.appendChild(comp);
    await comp.updateComplete;

    const conn = document.createElement("om-connector") as OmConnector;
    conn.nodeId = "p";
    conn.placement = { extent: [[60, -10], [80, 10]] } as Placement;
    comp.appendChild(conn);
    await conn.updateComplete;

    const sceneObj = scene.sceneContextValue!.scene;
    const compTransform = sceneObj.transformNodes.find(
      (n) => n.name === "om-component:block",
    );
    const connTransform = sceneObj.transformNodes.find(
      (n) => n.name === "om-connector:p",
    );
    expect(compTransform).toBeDefined();
    expect(connTransform).toBeDefined();
    expect(connTransform!.parent).toBe(compTransform);
    expect(connTransform!.position.x).toBe(70);
    expect(connTransform!.position.y).toBe(0);
  });
});
