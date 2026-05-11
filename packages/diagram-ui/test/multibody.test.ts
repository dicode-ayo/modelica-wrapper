import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core";

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
  scene.engineFactory = () =>
    new NullEngine({
      renderWidth: 200,
      renderHeight: 200,
      textureSize: 128,
      deterministicLockstep: false,
      lockstepMaxSteps: 1,
    });
  document.body.appendChild(scene);
  teardowns.push(() => scene.remove());
  await scene.updateComplete;
  return scene;
}

describe("camera mode toggle", () => {
  it("defaults to orthographic 2d mode", async () => {
    const scene = await mountScene();
    const camera = scene.sceneContextValue!.camera;
    expect(camera.mode).toBe(1); // ORTHOGRAPHIC
    expect(scene.cameraMode).toBe("2d");
  });

  it("switches to perspective when cameraMode='3d'", async () => {
    const scene = await mountScene();
    scene.cameraMode = "3d";
    await scene.updateComplete;
    const camera = scene.sceneContextValue!.camera;
    expect(camera.mode).toBe(0); // PERSPECTIVE
  });

  it("returns to ortho when cameraMode flips back to 2d", async () => {
    const scene = await mountScene();
    scene.cameraMode = "3d";
    await scene.updateComplete;
    scene.cameraMode = "2d";
    await scene.updateComplete;
    const camera = scene.sceneContextValue!.camera;
    expect(camera.mode).toBe(1);
  });
});

describe("<om-multibody-root>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("om-multibody-root")).toBeDefined();
  });

  it("parents its TransformNode under the scene's worldRoot", async () => {
    const scene = await mountScene();
    const mb = document.createElement(
      "om-multibody-root",
    ) as OmMultibodyRoot;
    scene.appendChild(mb);
    await mb.updateComplete;
    expect(mb.rootNode).not.toBeNull();
    expect(mb.rootNode!.parent).toBe(scene.sceneContextValue!.worldRoot);
  });

  it("disposes its TransformNode on disconnect", async () => {
    const scene = await mountScene();
    const mb = document.createElement(
      "om-multibody-root",
    ) as OmMultibodyRoot;
    scene.appendChild(mb);
    await mb.updateComplete;
    const node = mb.rootNode!;
    mb.remove();
    expect(node.isDisposed()).toBe(true);
  });
});
