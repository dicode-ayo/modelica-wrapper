import { describe, expect, it } from "vitest";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";

import { OmShapeNode } from "../src/base/shape-node.js";

function makeNode(): {
  node: OmShapeNode;
  scene: Scene;
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
  const node = new OmShapeNode(scene, parent, "om-shape:line:0");
  node.setPlacement(
    {
      extent: [
        [-10, -10],
        [10, 10],
      ],
    },
    undefined,
  );
  return {
    node,
    scene,
    dispose: () => {
      scene.dispose();
      engine.dispose();
    },
  };
}

/** Visible resize-corner / rotate handle meshes currently in the scene. */
function visibleHandles(scene: Scene): { resize: number; rotate: number } {
  const vis = scene.meshes.filter((m) => m.isVisible);
  return {
    resize: vis.filter((m) => m.name.startsWith("om-handle:")).length,
    rotate: vis.filter((m) => m.name === "om-rotate-handle").length,
  };
}

describe("OmShapeNode selection affordances", () => {
  it("shows resize + rotate handles by default when selected", () => {
    const { node, scene, dispose } = makeNode();
    node.setSelected(true);
    expect(visibleHandles(scene)).toEqual({ resize: 4, rotate: 1 });
    dispose();
  });

  it("suppresses resize + rotate handles when both affordances are off", () => {
    const { node, scene, dispose } = makeNode();
    node.setSelectionAffordances({ resize: false, rotate: false });
    node.setSelected(true);
    expect(visibleHandles(scene)).toEqual({ resize: 0, rotate: 0 });
    dispose();
  });

  it("hides already-shown handles when affordances are revoked live", () => {
    const { node, scene, dispose } = makeNode();
    node.setSelected(true);
    expect(visibleHandles(scene).resize).toBe(4);
    node.setSelectionAffordances({ resize: false, rotate: false });
    expect(visibleHandles(scene)).toEqual({ resize: 0, rotate: 0 });
    dispose();
  });

  it("reveals the hit tube and vertex dots on hover, like a connection edge", () => {
    const { node, scene, dispose } = makeNode();
    node.setPolyPoints([
      [-5, 0],
      [5, 0],
    ]);
    const dots = () =>
      scene.meshes.filter((m) => m.isVisible && m.name === "om-vertex-handle")
        .length;
    const tube = scene.meshes.find((m) => m.name.startsWith("hit.om-shape"));

    // At rest: tube invisible (still pickable), no dots.
    expect(tube?.visibility).toBe(0);
    expect(dots()).toBe(0);

    node.setHovered(true);
    expect(tube?.visibility).toBeGreaterThan(0);
    expect(dots()).toBe(2);

    node.setHovered(false);
    expect(tube?.visibility).toBe(0);
    expect(dots()).toBe(0);
    dispose();
  });
});
