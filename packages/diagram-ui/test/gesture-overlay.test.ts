import { describe, expect, it } from "vitest";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";

import {
  GestureOverlay,
  CONNECT_OK_COLOR,
} from "../src/base/gesture-overlay.js";

function makeScene(): { scene: Scene; dispose: () => void } {
  const engine = new NullEngine({
    renderWidth: 100,
    renderHeight: 100,
    textureSize: 64,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  const scene = new Scene(engine);
  return {
    scene,
    dispose: () => {
      scene.dispose();
      engine.dispose();
    },
  };
}

function meshCount(scene: Scene, name: string): number {
  return scene.meshes.filter((m) => m.name === name).length;
}

describe("GestureOverlay", () => {
  it("builds a wire on showWire and disposes it on hideWire", () => {
    const { scene, dispose } = makeScene();
    const overlay = new GestureOverlay(scene, new TransformNode("root", scene));

    overlay.showWire({ x: 0, y: 0 }, { x: 10, y: 5 }, CONNECT_OK_COLOR);
    expect(scene.getMeshByName("om-gesture-wire")).not.toBeNull();
    // The pick tube is feedback-only; it must not linger.
    expect(scene.getMeshByName("om-gesture-wire.hit")).toBeNull();

    overlay.hideWire();
    expect(scene.getMeshByName("om-gesture-wire")).toBeNull();
    dispose();
  });

  it("keeps a single wire across repeated showWire calls", () => {
    const { scene, dispose } = makeScene();
    const overlay = new GestureOverlay(scene, new TransformNode("root", scene));

    overlay.showWire({ x: 0, y: 0 }, { x: 10, y: 5 }, CONNECT_OK_COLOR);
    overlay.showWire({ x: 0, y: 0 }, { x: 20, y: 8 }, CONNECT_OK_COLOR);
    expect(meshCount(scene, "om-gesture-wire")).toBe(1);
    dispose();
  });

  it("builds a rect on showRect and disposes it on hideRect", () => {
    const { scene, dispose } = makeScene();
    const overlay = new GestureOverlay(scene, new TransformNode("root", scene));

    overlay.showRect({ x1: 0, y1: 0, x2: 10, y2: 10 });
    expect(scene.getMeshByName("om-rubber-band")).not.toBeNull();
    overlay.hideRect();
    expect(scene.getMeshByName("om-rubber-band")).toBeNull();
    dispose();
  });

  it("dispose() clears both the wire and the rect", () => {
    const { scene, dispose } = makeScene();
    const overlay = new GestureOverlay(scene, new TransformNode("root", scene));

    overlay.showWire({ x: 0, y: 0 }, { x: 10, y: 5 }, CONNECT_OK_COLOR);
    overlay.showRect({ x1: 0, y1: 0, x2: 10, y2: 10 });
    overlay.dispose();

    expect(scene.getMeshByName("om-gesture-wire")).toBeNull();
    expect(scene.getMeshByName("om-rubber-band")).toBeNull();
    dispose();
  });
});
