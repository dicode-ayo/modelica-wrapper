import { describe, expect, it } from "vitest";
import { NullEngine, Scene, TransformNode, Mesh } from "@babylonjs/core";

import { MOVE_KINDS, ownerOfHandle } from "../src/interaction/gesture-mode.js";

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

describe("MOVE_KINDS", () => {
  it("includes host shapes so a shape pick begins a move-drag", () => {
    expect(MOVE_KINDS.has("shape")).toBe(true);
  });

  it("still excludes connectors (a connector pick starts a connection)", () => {
    expect(MOVE_KINDS.has("connector")).toBe(false);
  });
});

describe("ownerOfHandle", () => {
  it("resolves a handle under a host-shape wrapper to its shape key", () => {
    const { scene, dispose } = makeScene();
    const wrapper = new TransformNode("om-shape:rectangle:2", scene);
    const handle = new Mesh("handle.tl", scene);
    handle.parent = wrapper;
    expect(ownerOfHandle(handle)).toBe("shape:rectangle:2");
    dispose();
  });

  it("resolves a component handle, unchanged by the shape addition", () => {
    const { scene, dispose } = makeScene();
    const wrapper = new TransformNode("om-component:R1", scene);
    const handle = new Mesh("handle.br", scene);
    handle.parent = wrapper;
    expect(ownerOfHandle(handle)).toBe("c:R1");
    dispose();
  });

  it("returns null when no owner is in the chain", () => {
    const { scene, dispose } = makeScene();
    expect(ownerOfHandle(new TransformNode("plain", scene))).toBeNull();
    dispose();
  });
});
