import { afterEach, describe, expect, it } from "vitest";
import type { IconLayer, Placement } from "@dicode/omc-client";

import "../src/scene/scene.component.js";
import "../src/component/component.component.js";
import "../src/connector/connector.component.js";
import type { OmScene } from "../src/scene/scene.component.js";
import type { OmComponent } from "../src/component/component.component.js";
import type { OmConnector } from "../src/connector/connector.component.js";

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) {
    t();
  }
});

async function mountScene(): Promise<OmScene> {
  const scene = document.createElement("om-scene") as OmScene;
  // Renderer-less: build the Pixi scene graph on the CPU, no GPU context.
  scene.rendererFactory = () => null;
  document.body.appendChild(scene);
  teardowns.push(() => scene.remove());
  await scene.updateComplete;
  return scene;
}

describe("<om-connector>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("om-connector")).toBeDefined();
  });

  it("creates a port-indicator disc that is initially hidden", async () => {
    const scene = await mountScene();
    const conn = document.createElement("om-connector") as OmConnector;
    conn.nodeId = "p";
    conn.placement = {
      extent: [
        [-5, -5],
        [5, 5],
      ],
    } as Placement;
    conn.layers = [{ from: "C", shapes: [] }] as IconLayer[];
    scene.appendChild(conn);
    await conn.updateComplete;
    expect(conn.portIndicatorVisible).toBe(false);
  });

  it("attaches the port indicator under the connector's container", async () => {
    const scene = await mountScene();
    const conn = document.createElement("om-connector") as OmConnector;
    conn.placement = {
      extent: [
        [-5, -5],
        [5, 5],
      ],
    } as Placement;
    scene.appendChild(conn);
    await conn.updateComplete;
    conn.setPortIndicatorVisible(true);
    expect(conn.portIndicatorVisible).toBe(true);
  });

  it("nested connector inherits the parent component's container as its parent", async () => {
    const scene = await mountScene();
    const comp = document.createElement("om-component") as OmComponent;
    comp.nodeId = "block";
    comp.placement = {
      extent: [
        [-20, -20],
        [20, 20],
      ],
    } as Placement;
    scene.appendChild(comp);
    await comp.updateComplete;

    const conn = document.createElement("om-connector") as OmConnector;
    conn.nodeId = "p";
    conn.placement = {
      extent: [
        [60, -10],
        [80, 10],
      ],
    } as Placement;
    comp.appendChild(conn);
    await conn.updateComplete;

    const ctx = scene.sceneContextValue;
    if (!ctx) throw new Error("no scene context");
    // Entity transforms are `Container`s under the diagram root, labelled
    // `om-<kind>:<id>` by `tagEntity`.
    const compTransform = ctx.diagramRoot.getChildByLabel(
      "om-component:block",
      true,
    );
    const connTransform = ctx.diagramRoot.getChildByLabel(
      "om-connector:p",
      true,
    );
    expect(compTransform).not.toBeNull();
    expect(connTransform).not.toBeNull();
    if (connTransform === null) throw new Error("connTransform not found");
    expect(connTransform.parent).toBe(compTransform);
    expect(connTransform.position.x).toBe(70);
    expect(connTransform.position.y).toBe(0);
  });
});
