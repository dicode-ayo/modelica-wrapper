/**
 * Tests for the Modelica arrowhead geometry and mesh-building utilities.
 *
 * Pure-math coverage (`arrowheadVertices`) runs without a Babylon engine.
 * Mesh-building coverage (`buildArrowhead`) uses NullEngine so mesh creation
 * can be asserted without a real WebGL context — visual correctness is
 * covered by the `Shapes — ArrowLines` Storybook / Chromatic story.
 */

import { afterEach, describe, expect, it } from "vitest";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";

import {
  DEFAULT_ARROW_SIZE,
  arrowheadVertices,
  buildArrowhead,
} from "../src/primitives/arrow-utils.js";

// ─── Pure geometry ────────────────────────────────────────────────────────────

const HALF_ANGLE_RAD = 15 * (Math.PI / 180);
const TAN_HA = Math.tan(HALF_ANGLE_RAD);

describe("arrowheadVertices", () => {
  it("places the tip exactly at the given endpoint", () => {
    const v = arrowheadVertices([10, 20], 1, 0, 5);
    expect(v.tip).toEqual([10, 20]);
  });

  it("places base corners symmetrically for a rightward arrow", () => {
    const size = 4;
    const v = arrowheadVertices([10, 0], 1, 0, size);
    const hw = size * TAN_HA;
    // base centre is at (10-4, 0) = (6, 0); perp for +X is (0,1)
    expect(v.left[0]).toBeCloseTo(6);
    expect(v.left[1]).toBeCloseTo(hw);
    expect(v.right[0]).toBeCloseTo(6);
    expect(v.right[1]).toBeCloseTo(-hw);
  });

  it("places base corners symmetrically for an upward arrow", () => {
    const size = 3;
    const v = arrowheadVertices([0, 10], 0, 1, size);
    const hw = size * TAN_HA;
    // base centre is at (0, 7); perp for +Y is (-1, 0)
    expect(v.left[0]).toBeCloseTo(-hw);
    expect(v.left[1]).toBeCloseTo(7);
    expect(v.right[0]).toBeCloseTo(hw);
    expect(v.right[1]).toBeCloseTo(7);
  });

  it("left and right are equidistant from the base centreline", () => {
    const v = arrowheadVertices([5, 5], 0.6, 0.8, 10);
    const bx = 5 - 0.6 * 10;
    const by = 5 - 0.8 * 10;
    const dLeft = Math.hypot(v.left[0] - bx, v.left[1] - by);
    const dRight = Math.hypot(v.right[0] - bx, v.right[1] - by);
    expect(dLeft).toBeCloseTo(dRight, 10);
  });

  it("half-angle from shaft to each corner is 15°", () => {
    const v = arrowheadVertices([10, 0], 1, 0, 4);
    // Vector from tip to left corner
    const tx = v.left[0] - v.tip[0];
    const ty = v.left[1] - v.tip[1];
    // Back-direction (opposite of rightward) = (-1, 0)
    const cos = (tx * -1 + ty * 0) / Math.hypot(tx, ty);
    expect(Math.acos(Math.min(1, cos))).toBeCloseTo(HALF_ANGLE_RAD, 10);
  });

  it("tip is at the correct arrowhead length from each base corner", () => {
    const size = 5;
    const v = arrowheadVertices([0, 0], 1, 0, size);
    const hw = size * TAN_HA;
    const expected = Math.sqrt(size * size + hw * hw);
    expect(Math.hypot(v.tip[0] - v.left[0], v.tip[1] - v.left[1])).toBeCloseTo(
      expected,
    );
    expect(
      Math.hypot(v.tip[0] - v.right[0], v.tip[1] - v.right[1]),
    ).toBeCloseTo(expected);
  });

  it("works for a diagonal direction", () => {
    // 45° direction (unit vector)
    const d = Math.SQRT1_2;
    const v = arrowheadVertices([0, 0], d, d, 4);
    // Both base corners lie at the same distance from the base centre
    const bx = 0 - d * 4;
    const by = 0 - d * 4;
    const dLeft = Math.hypot(v.left[0] - bx, v.left[1] - by);
    const dRight = Math.hypot(v.right[0] - bx, v.right[1] - by);
    expect(dLeft).toBeCloseTo(dRight, 10);
    // And the arrowhead half-angle still holds
    const tx = v.left[0] - v.tip[0];
    const ty = v.left[1] - v.tip[1];
    const backX = -d;
    const backY = -d;
    const cos = (tx * backX + ty * backY) / Math.hypot(tx, ty);
    expect(Math.acos(Math.min(1, cos))).toBeCloseTo(HALF_ANGLE_RAD, 10);
  });
});

// ─── Babylon mesh building ────────────────────────────────────────────────────

const teardowns: Array<() => void> = [];

function makeScene(): { scene: Scene; parent: TransformNode } {
  const engine = new NullEngine({
    renderWidth: 320,
    renderHeight: 240,
    textureSize: 256,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  const scene = new Scene(engine);
  const parent = new TransformNode("test-parent", scene);
  teardowns.push(() => {
    scene.dispose();
    engine.dispose();
  });
  return { scene, parent };
}

afterEach(() => {
  for (const t of teardowns.splice(0)) t();
});

const COLOR: [number, number, number] = [0, 0, 0];
const TIP: [number, number] = [10, 0];

describe("buildArrowhead", () => {
  it("returns null for Arrow.None", () => {
    const { scene, parent } = makeScene();
    const result = buildArrowhead(
      scene,
      parent,
      TIP,
      1,
      0,
      3,
      "None",
      COLOR,
      0,
      "test",
    );
    expect(result).toBeNull();
  });

  it("returns null for an empty kind string", () => {
    const { scene, parent } = makeScene();
    const result = buildArrowhead(
      scene,
      parent,
      TIP,
      1,
      0,
      3,
      "",
      COLOR,
      0,
      "test",
    );
    expect(result).toBeNull();
  });

  it("returns null for a zero-length direction vector", () => {
    const { scene, parent } = makeScene();
    const result = buildArrowhead(
      scene,
      parent,
      TIP,
      0,
      0,
      3,
      "Filled",
      COLOR,
      0,
      "test",
    );
    expect(result).toBeNull();
  });

  it("returns null for a non-positive size", () => {
    const { scene, parent } = makeScene();
    expect(
      buildArrowhead(scene, parent, TIP, 1, 0, 0, "Filled", COLOR, 0, "test"),
    ).toBeNull();
    expect(
      buildArrowhead(scene, parent, TIP, 1, 0, -1, "Filled", COLOR, 0, "test"),
    ).toBeNull();
  });

  it("returns null for an unknown arrow kind", () => {
    const { scene, parent } = makeScene();
    const result = buildArrowhead(
      scene,
      parent,
      TIP,
      1,
      0,
      3,
      "Unknown",
      COLOR,
      0,
      "test",
    );
    expect(result).toBeNull();
  });

  it("returns a disposable resource for Filled", () => {
    const { scene, parent } = makeScene();
    const result = buildArrowhead(
      scene,
      parent,
      TIP,
      1,
      0,
      DEFAULT_ARROW_SIZE,
      "Filled",
      COLOR,
      0,
      "test",
    );
    expect(result).not.toBeNull();
    expect(() => result?.dispose()).not.toThrow();
  });

  it("returns a disposable resource for Open", () => {
    const { scene, parent } = makeScene();
    const result = buildArrowhead(
      scene,
      parent,
      TIP,
      1,
      0,
      DEFAULT_ARROW_SIZE,
      "Open",
      COLOR,
      0,
      "test",
    );
    expect(result).not.toBeNull();
    expect(() => result?.dispose()).not.toThrow();
  });

  it("returns a disposable resource for Half", () => {
    const { scene, parent } = makeScene();
    const result = buildArrowhead(
      scene,
      parent,
      TIP,
      1,
      0,
      DEFAULT_ARROW_SIZE,
      "Half",
      COLOR,
      0,
      "test",
    );
    expect(result).not.toBeNull();
    expect(() => result?.dispose()).not.toThrow();
  });

  it("normalises a non-unit direction without error", () => {
    const { scene, parent } = makeScene();
    // Pass a vector of length 5 — should still produce a valid mesh
    const result = buildArrowhead(
      scene,
      parent,
      TIP,
      5,
      0,
      3,
      "Filled",
      COLOR,
      0,
      "test",
    );
    expect(result).not.toBeNull();
    expect(() => result?.dispose()).not.toThrow();
  });

  it("Filled arrowhead mesh is not pickable", () => {
    const { scene, parent } = makeScene();
    const before = scene.meshes.length;
    buildArrowhead(scene, parent, TIP, 1, 0, 3, "Filled", COLOR, 0, "test");
    const added = scene.meshes.filter((m) => !m.isPickable);
    expect(scene.meshes.length).toBeGreaterThan(before);
    expect(added.length).toBeGreaterThan(0);
  });
});
