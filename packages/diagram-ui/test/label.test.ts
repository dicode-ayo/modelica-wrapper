import { afterEach, describe, expect, it } from "vitest";
import type { Container } from "pixi.js";

import "../src/scene/scene.component.js";
import "../src/label/label.component.js";
import type { OmScene } from "../src/scene/scene.component.js";
import type { OmLabel } from "../src/label/label.component.js";

afterEach(() => {
  document.body.replaceChildren();
});

async function mountScene(): Promise<OmScene> {
  const scene = document.createElement("om-scene") as OmScene;
  // Renderer-less: the scene graph is built on the CPU with no GPU
  // context, so labels take the headless path (no overlay `Text`).
  scene.rendererFactory = () => null;
  document.body.appendChild(scene);
  await scene.updateComplete;
  return scene;
}

function contextOf(el: OmScene): NonNullable<OmScene["sceneContextValue"]> {
  const ctx = el.sceneContextValue;
  if (ctx === null) {
    throw new Error("scene context not ready");
  }
  return ctx;
}

function labelAnchors(diagramRoot: Container): Container[] {
  return diagramRoot.children.filter((c) => c.label.startsWith("om-label:"));
}

describe("<om-label>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("om-label")).toBeDefined();
  });

  it("keeps plain-string text available via currentText headless", async () => {
    const scene = await mountScene();
    const label = document.createElement("om-label") as OmLabel;
    label.nodeId = "title";
    label.text = "Hello";
    label.x = 5;
    label.y = 10;
    scene.appendChild(label);
    await label.updateComplete;
    // No renderer → no overlay `Text`; the text falls back to the
    // pending string captured during sync.
    expect(label.currentText).toBe("Hello");
  });

  it("attaches an in-world anchor under diagramRoot", async () => {
    const scene = await mountScene();
    const diagramRoot = contextOf(scene).diagramRoot;
    const label = document.createElement("om-label") as OmLabel;
    label.nodeId = "title";
    label.x = 5;
    label.y = 10;
    scene.appendChild(label);
    await label.updateComplete;

    const anchors = labelAnchors(diagramRoot);
    expect(anchors).toHaveLength(1);
    const anchor = anchors[0];
    if (!anchor) throw new Error("no anchor");
    expect(anchor.label).toBe("om-label:title");
    expect(anchor.position.x).toBeCloseTo(5, 5);
    expect(anchor.position.y).toBeCloseTo(10, 5);
  });

  it("cleans up the anchor on disconnect", async () => {
    const scene = await mountScene();
    const diagramRoot = contextOf(scene).diagramRoot;
    const label = document.createElement("om-label") as OmLabel;
    label.text = "Goodbye";
    scene.appendChild(label);
    await label.updateComplete;
    expect(labelAnchors(diagramRoot)).toHaveLength(1);

    label.remove();
    expect(labelAnchors(diagramRoot)).toHaveLength(0);
  });
});
