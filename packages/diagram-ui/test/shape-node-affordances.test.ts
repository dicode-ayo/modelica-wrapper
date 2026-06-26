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

  it("keeps the handles on the extent box when rotation shifts its centre", () => {
    const { node, scene, dispose } = makeNode();
    const handleCentroid = (): { x: number; y: number } => {
      const hs = scene.meshes.filter((m) => m.name.startsWith("om-handle:"));
      const n = hs.length || 1;
      return {
        x: hs.reduce((s, m) => s + m.position.x, 0) / n,
        y: hs.reduce((s, m) => s + m.position.y, 0) / n,
      };
    };

    // Off-centre extent → handles centred on (150, 240).
    node.setDiagramBounds(
      [
        [50, 200],
        [250, 280],
      ],
      undefined,
      0,
    );
    node.setSelected(true);
    expect(handleCentroid().x).toBeCloseTo(150);
    expect(handleCentroid().y).toBeCloseTo(240);

    // Rotation rebases the origin: same-size extent re-centres on (0, 0).
    // The handles must follow, not stay at the old centre.
    node.setDiagramBounds(
      [
        [-100, -40],
        [100, 40],
      ],
      [150, 240],
      90,
    );
    expect(handleCentroid().x).toBeCloseTo(0);
    expect(handleCentroid().y).toBeCloseTo(0);
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
