import { describe, expect, it } from "vitest";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
import type { Color } from "@dicode/omc-client";

import { buildStroke } from "../src/primitives/shape-utils.js";

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
  const parent = new TransformNode("parent", scene);
  return {
    scene,
    parent,
    dispose: () => {
      scene.dispose();
      engine.dispose();
    },
  };
}

const RED: Color = [255, 0, 0];

describe("buildStroke", () => {
  it("returns null for a non-drawable stroke", () => {
    const { scene, parent, dispose } = makeScene();
    expect(
      buildStroke(scene, parent, [[0, 0]], RED, undefined, 0, "s"),
    ).toBeNull();
    expect(
      buildStroke(
        scene,
        parent,
        [
          [0, 0],
          [1, 1],
        ],
        RED,
        "None",
        0,
        "s",
      ),
    ).toBeNull();
    dispose();
  });

  it("builds a solid stroke as a non-pickable GreasedLine", () => {
    const { scene, parent, dispose } = makeScene();
    const res = buildStroke(
      scene,
      parent,
      [
        [0, 0],
        [10, 0],
      ],
      RED,
      undefined,
      0,
      "stroke",
    );
    expect(res).not.toBeNull();
    const mesh = scene.meshes.find((m) => m.name === "stroke");
    expect(mesh?.isPickable).toBe(false);
    expect(mesh?.getClassName()).toContain("GreasedLine");
    dispose();
  });

  it("builds a dashed stroke as a GreasedLine too (unified renderer)", () => {
    const { scene, parent, dispose } = makeScene();
    const res = buildStroke(
      scene,
      parent,
      [
        [0, 0],
        [10, 0],
      ],
      RED,
      "Dash",
      0,
      "dashed",
    );
    expect(res).not.toBeNull();
    const mesh = scene.meshes.find((m) => m.name === "dashed");
    expect(mesh?.isPickable).toBe(false);
    expect(mesh?.getClassName()).toContain("GreasedLine");
    dispose();
  });
});
