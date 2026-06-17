import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core";

import "../src/scene/scene.component.js";
import "../src/label/label.component.js";
import type { OmScene } from "../src/scene/scene.component.js";
import type { OmLabel } from "../src/label/label.component.js";

const teardowns: Array<() => void> = [];

afterEach(async () => {
  for (const t of teardowns.splice(0)) {
    t();
  }
  // Give Babylon.GUI's debounced refresh timer one tick to flush — it
  // schedules an update via DelayAsync which would otherwise fire on a
  // disposed texture and surface as an unhandled error.
  await new Promise((r) => setTimeout(r, 150));
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

describe("<om-label>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("om-label")).toBeDefined();
  });

  it("renders plain-string text into the AdvancedDynamicTexture", async () => {
    const scene = await mountScene();
    const label = document.createElement("om-label") as OmLabel;
    label.nodeId = "title";
    label.text = "Hello";
    label.x = 5;
    label.y = 10;
    scene.appendChild(label);
    await label.updateComplete;
    expect(label.currentText).toBe("Hello");
  });

  it("cleans up the anchor on disconnect", async () => {
    const scene = await mountScene();
    const label = document.createElement("om-label") as OmLabel;
    label.text = "Goodbye";
    scene.appendChild(label);
    await label.updateComplete;
    label.remove();
    const ctx = scene.sceneContextValue;
    if (!ctx) throw new Error("no scene context");
    const sceneObj = ctx.scene;
    const labelNode = sceneObj.transformNodes.find((n) =>
      n.name.startsWith("om-label"),
    );
    expect(labelNode).toBeUndefined();
  });
});
