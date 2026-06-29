import { describe, expect, it } from "vitest";
import {
  NullEngine,
  Scene,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import type { Color } from "@dicode/omc-client";

import { buildStroke, worldScaleOf } from "../src/primitives/shape-utils.js";

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

describe("worldScaleOf", () => {
  it("is the geometric mean of |x|/|y| scale, sign-safe and floored", () => {
    const { scene, dispose } = makeScene();
    const n = new TransformNode("n", scene);

    n.scaling.set(1, 1, 1);
    expect(worldScaleOf(n)).toBeCloseTo(1);

    n.scaling.set(0.1, 0.1, 1);
    expect(worldScaleOf(n)).toBeCloseTo(0.1);

    // Non-square + mirrored: |(-0.2) * 0.05| = 0.01 → 0.1, never negative.
    n.scaling.set(-0.2, 0.05, 1);
    expect(worldScaleOf(n)).toBeCloseTo(0.1);

    // Degenerate zero scale falls back to 1 (no divide-by-zero radius).
    n.scaling.set(0, 0, 1);
    expect(worldScaleOf(n)).toBe(1);

    dispose();
  });
});

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
    // All-equal points → no segment → null.
    expect(
      buildStroke(
        scene,
        parent,
        [
          [5, 5],
          [5, 5],
        ],
        RED,
        undefined,
        0,
        "s",
      ),
    ).toBeNull();
    dispose();
  });

  it("builds a solid stroke as an unlit, non-pickable tube in the stroke colour", () => {
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
    const mat = mesh?.material;
    expect(mat).toBeInstanceOf(StandardMaterial);
    expect((mat as StandardMaterial).disableLighting).toBe(true);
    expect((mat as StandardMaterial).emissiveColor.r).toBeCloseTo(1);
    expect((mat as StandardMaterial).emissiveColor.g).toBeCloseTo(0);
    dispose();
  });

  it("builds a dashed stroke as a GL line (no material), not a tube", () => {
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
    // The dashed branch is a GL LinesMesh, not the solid path's tube Mesh.
    expect(mesh?.getClassName()).toBe("LinesMesh");
    dispose();
  });
});
