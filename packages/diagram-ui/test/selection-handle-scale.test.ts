import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";

import { ResizeHandles, RotateHandle } from "../src/base/selection-overlay.js";
import type { SceneContext } from "../src/scene/scene-context.js";

/**
 * Handles are parented to the shape's transform, which carries the
 * icon→placement scale. A constant screen-pixel size therefore requires
 * `rescale()` to divide its world size by that parent scale — otherwise a
 * component placed small (parent scale ≪ 1) renders sub-pixel handles.
 */
function makeScene(): {
  ctx: SceneContext;
  parent: Container;
  dispose: () => void;
} {
  const stage = new Container({ label: "om-stage" });
  const worldRoot = new Container({ label: "om-world" });
  const diagramRoot = new Container({ label: "om-diagram" });
  worldRoot.addChild(diagramRoot);
  stage.addChild(worldRoot);
  // worldPerPixel = 1: a screen pixel spans one diagram unit, matching the
  // old ortho camera with world width 100 across a 100px canvas.
  const ctx: SceneContext = {
    renderer: null,
    stage,
    worldRoot,
    diagramRoot,
    pick: () => null,
    worldPerPixel: () => 1,
    requestRender: () => {},
  };
  const parent = new Container({ label: "om-shape" });
  diagramRoot.addChild(parent);
  return {
    ctx,
    parent,
    dispose: () => stage.destroy({ children: true }),
  };
}

describe("selection handle pixel sizing", () => {
  it("divides the rotate handle's scaling by the parent transform scale", () => {
    const { ctx, parent, dispose } = makeScene();
    parent.scale.set(0.1, 0.1);

    const handle = new RotateHandle(ctx, parent, 20, 20, 0, 0);
    handle.setVisible(true);

    const mesh = parent.getChildByLabel("om-rotate-handle:rotate", true);
    if (!mesh) throw new Error("expected the rotate handle container");
    // worldPerPixel = 1, pixelSize = 10, parentScale = 0.1 → 10 / 0.1 = 100.
    expect(mesh.scale.x).toBeCloseTo(100);
    expect(mesh.scale.y).toBeCloseTo(100);

    handle.dispose();
    dispose();
  });

  it("divides each resize handle's scaling by the parent transform scale", () => {
    const { ctx, parent, dispose } = makeScene();
    parent.scale.set(0.1, 0.1);

    const handles = new ResizeHandles(ctx, parent, 20, 20, 0, 0);
    handles.setVisible(true);

    const corner = parent.getChildByLabel("om-handle:tl", true);
    if (!corner) throw new Error("expected a corner handle container");
    // worldPerPixel = 1, pixelSize = 8, parentScale = 0.1 → 8 / 0.1 = 80.
    expect(corner.scale.x).toBeCloseTo(80);
    expect(corner.scale.y).toBeCloseTo(80);

    handles.dispose();
    dispose();
  });
});
