import { describe, expect, it } from "vitest";
import {
  ArcRotateCamera,
  NullEngine,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

import { ResizeHandles, RotateHandle } from "../src/base/selection-overlay.js";

/**
 * Handles are parented to the shape's transform, which carries the
 * icon→placement scale. A constant screen-pixel size therefore requires
 * `rescale()` to divide its world size by that parent scale — otherwise a
 * component placed small (parent scale ≪ 1) renders sub-pixel handles.
 */
function makeScene(): {
  scene: Scene;
  parent: TransformNode;
  dispose: () => void;
} {
  const engine = new NullEngine({
    renderWidth: 100,
    renderHeight: 100,
    textureSize: 64,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera("cam", 0, 0, 10, Vector3.Zero(), scene);
  // World width 100 across a 100px canvas → worldPerPixel = 1.
  camera.orthoLeft = -50;
  camera.orthoRight = 50;
  camera.orthoTop = 50;
  camera.orthoBottom = -50;
  scene.activeCamera = camera;
  const parent = new TransformNode("om-shape", scene);
  return {
    scene,
    parent,
    dispose: () => {
      scene.dispose();
      engine.dispose();
    },
  };
}

describe("selection handle pixel sizing", () => {
  it("divides the rotate handle's scaling by the parent transform scale", () => {
    const { scene, parent, dispose } = makeScene();
    parent.scaling.set(0.1, 0.1, 1);

    const handle = new RotateHandle(scene, parent, 20, 20, 0, 0);
    handle.setVisible(true);

    const mesh = scene.getMeshByName("om-rotate-handle");
    if (!mesh) throw new Error("expected the rotate handle mesh");
    // worldPerPixel = 1, pixelSize = 10, parentScale = 0.1 → 10 / 0.1 = 100.
    expect(mesh.scaling.x).toBeCloseTo(100);
    expect(mesh.scaling.y).toBeCloseTo(100);

    handle.dispose();
    dispose();
  });

  it("divides each resize handle's scaling by the parent transform scale", () => {
    const { scene, parent, dispose } = makeScene();
    parent.scaling.set(0.1, 0.1, 1);

    const handles = new ResizeHandles(scene, parent, 20, 20, 0, 0);
    handles.setVisible(true);

    const corner = scene.getMeshByName("om-handle:tl");
    if (!corner) throw new Error("expected a corner handle mesh");
    // worldPerPixel = 1, pixelSize = 8, parentScale = 0.1 → 8 / 0.1 = 80.
    expect(corner.scaling.x).toBeCloseTo(80);
    expect(corner.scaling.y).toBeCloseTo(80);

    handles.dispose();
    dispose();
  });
});
