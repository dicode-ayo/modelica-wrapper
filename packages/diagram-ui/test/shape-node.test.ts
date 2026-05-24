import { afterEach, describe, expect, it } from "vitest";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
import type { Placement } from "@dicode/omc-client";

import { OmShapeNode } from "../src/base/shape-node.js";

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
  for (const t of teardowns.splice(0)) {
    t();
  }
});

describe("OmShapeNode", () => {
  it("creates a TransformNode parented under the provided node", () => {
    const { scene, parent } = makeScene();
    const node = new OmShapeNode(scene, parent);
    expect(node.transform.parent).toBe(parent);
    expect(node.mesh.parent).toBe(node.transform);
  });

  it("setPlacement aligns the TransformNode to the placement center", () => {
    const { scene, parent } = makeScene();
    const node = new OmShapeNode(scene, parent);
    const placement: Placement = { extent: [[10, 20], [30, 40]] };
    node.setPlacement(placement, undefined);
    expect(node.transform.position.x).toBe(20);
    expect(node.transform.position.y).toBe(30);
  });

  it("setPlacement scales by (placement / coord-system) to keep local space icon-native", () => {
    const { scene, parent } = makeScene();
    const node = new OmShapeNode(scene, parent);
    const placement: Placement = { extent: [[-10, -10], [10, 10]] };
    node.setPlacement(placement, {
      extent: [[-100, -100], [100, 100]],
    });
    expect(node.transform.scaling.x).toBeCloseTo(20 / 200);
    expect(node.transform.scaling.y).toBeCloseTo(20 / 200);
  });

  it("dispose cleans up the TransformNode and mesh", () => {
    const { scene, parent } = makeScene();
    const node = new OmShapeNode(scene, parent);
    const mesh = node.mesh;
    node.dispose();
    expect(mesh.isDisposed()).toBe(true);
    expect(node.transform.isDisposed()).toBe(true);
  });
});
