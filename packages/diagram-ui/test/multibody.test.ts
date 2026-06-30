import { afterEach, describe, expect, it } from "vitest";

import "../src/scene/scene.component.js";
import "../src/multibody/multibody-root.component.js";
import type { OmScene } from "../src/scene/scene.component.js";
import type { OmMultibodyRoot } from "../src/multibody/multibody-root.component.js";

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) {
    t();
  }
});

async function mountScene(): Promise<OmScene> {
  const scene = document.createElement("om-scene") as OmScene;
  scene.rendererFactory = () => null;
  document.body.appendChild(scene);
  teardowns.push(() => scene.remove());
  await scene.updateComplete;
  return scene;
}

describe("camera mode toggle", () => {
  it("defaults to orthographic 2d mode", async () => {
    const scene = await mountScene();
    expect(scene.cameraMode).toBe("2d");
  });

  it("switches to 3d when cameraMode='3d'", async () => {
    const scene = await mountScene();
    scene.cameraMode = "3d";
    await scene.updateComplete;
    expect(scene.cameraMode).toBe("3d");
  });

  it("returns to 2d when cameraMode flips back", async () => {
    const scene = await mountScene();
    scene.cameraMode = "3d";
    await scene.updateComplete;
    scene.cameraMode = "2d";
    await scene.updateComplete;
    expect(scene.cameraMode).toBe("2d");
  });
});

describe("<om-multibody-root>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("om-multibody-root")).toBeDefined();
  });

  it("parents its root Container under the scene's worldRoot", async () => {
    const scene = await mountScene();
    const mb = document.createElement("om-multibody-root") as OmMultibodyRoot;
    scene.appendChild(mb);
    await mb.updateComplete;
    expect(mb.rootNode).not.toBeNull();
    const rootNode = mb.rootNode;
    if (!rootNode) throw new Error("expected rootNode");
    const ctx = scene.sceneContextValue;
    if (!ctx) throw new Error("no scene context");
    expect(rootNode.parent).toBe(ctx.worldRoot);
  });

  it("disposes its root Container on disconnect", async () => {
    const scene = await mountScene();
    const mb = document.createElement("om-multibody-root") as OmMultibodyRoot;
    scene.appendChild(mb);
    await mb.updateComplete;
    const node = mb.rootNode;
    if (!node) throw new Error("expected rootNode");
    mb.remove();
    expect(node.destroyed).toBe(true);
  });
});
