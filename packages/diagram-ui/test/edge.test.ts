import { afterEach, describe, expect, it } from "vitest";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";

import "../src/scene/scene.component.js";
import "../src/connection/edge.component.js";
import type { OmScene } from "../src/scene/scene.component.js";
import type { OmEdge } from "../src/connection/edge.component.js";
import { buildEdge } from "../src/connection/edge-build.js";

const teardowns: Array<() => void> = [];

function makeScene(): {
  scene: Scene;
  parent: TransformNode;
  dispose: () => void;
} {
  const engine = new NullEngine({
    renderWidth: 200,
    renderHeight: 200,
    textureSize: 128,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  const scene = new Scene(engine);
  const parent = new TransformNode("p", scene);
  return {
    scene,
    parent,
    dispose: () => {
      scene.dispose();
      engine.dispose();
    },
  };
}

afterEach(() => {
  for (const t of teardowns.splice(0)) {
    t();
  }
});

describe("buildEdge", () => {
  it("returns null when given fewer than 2 points", () => {
    const s = makeScene();
    teardowns.push(s.dispose);
    expect(buildEdge(s.scene, s.parent, "edge", { points: [] })).toBeNull();
    expect(
      buildEdge(s.scene, s.parent, "edge", { points: [[0, 0]] }),
    ).toBeNull();
  });

  it("builds a GreasedLine mesh parented to the provided node", () => {
    const s = makeScene();
    teardowns.push(s.dispose);
    const result = buildEdge(s.scene, s.parent, "edge", {
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.line.parent).toBe(s.parent);
    expect(result!.hitArea.parent).toBe(s.parent);
    expect(result!.hitArea.isPickable).toBe(true);
    expect(result!.hitArea.isVisible).toBe(false);
  });
});

describe("<om-edge>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("om-edge")).toBeDefined();
  });

  it("creates a mesh when path has >= 2 points", async () => {
    const scene = document.createElement("om-scene") as OmScene;
    scene.engineFactory = () =>
      new NullEngine({
        renderWidth: 200,
        renderHeight: 200,
        textureSize: 128,
        deterministicLockstep: false,
        lockstepMaxSteps: 1,
      });
    document.body.appendChild(scene);
    teardowns.push(() => scene.remove());
    await scene.updateComplete;

    const edge = document.createElement("om-edge") as OmEdge;
    edge.nodeId = "e1";
    edge.path = [
      [0, 0],
      [50, 0],
      [50, 30],
    ];
    scene.appendChild(edge);
    await edge.updateComplete;
    expect(edge.edgeMesh).not.toBeNull();
  });

  it("does not rebuild the mesh when a fresh path with identical content is assigned", async () => {
    // Simulates an OMC layout roundtrip: the host pushes a new
    // DiagramLayout object whose connection waypoints have identical
    // numbers but a fresh array identity. Lit fires updated() with
    // `path` in `changed`, but the geometry is unchanged — we must
    // keep the same LinesMesh, not dispose + recreate it.
    const scene = document.createElement("om-scene") as OmScene;
    scene.engineFactory = () =>
      new NullEngine({
        renderWidth: 200,
        renderHeight: 200,
        textureSize: 128,
        deterministicLockstep: false,
        lockstepMaxSteps: 1,
      });
    document.body.appendChild(scene);
    teardowns.push(() => scene.remove());
    await scene.updateComplete;

    const edge = document.createElement("om-edge") as OmEdge;
    edge.path = [
      [0, 0],
      [50, 0],
      [50, 30],
    ];
    scene.appendChild(edge);
    await edge.updateComplete;
    const original = edge.edgeMesh;
    expect(original).not.toBeNull();

    edge.path = [
      [0, 0],
      [50, 0],
      [50, 30],
    ];
    await edge.updateComplete;
    expect(edge.edgeMesh).toBe(original);
    expect(original!.line.isDisposed()).toBe(false);
  });

  it("rebuilds the mesh when the path content actually changes", async () => {
    const scene = document.createElement("om-scene") as OmScene;
    scene.engineFactory = () =>
      new NullEngine({
        renderWidth: 200,
        renderHeight: 200,
        textureSize: 128,
        deterministicLockstep: false,
        lockstepMaxSteps: 1,
      });
    document.body.appendChild(scene);
    teardowns.push(() => scene.remove());
    await scene.updateComplete;

    const edge = document.createElement("om-edge") as OmEdge;
    edge.path = [
      [0, 0],
      [50, 0],
    ];
    scene.appendChild(edge);
    await edge.updateComplete;
    const original = edge.edgeMesh;
    expect(original).not.toBeNull();

    edge.path = [
      [0, 0],
      [60, 0],
    ];
    await edge.updateComplete;
    expect(edge.edgeMesh).not.toBe(original);
    expect(original!.line.isDisposed()).toBe(true);
  });

  it("disposes the mesh on disconnect", async () => {
    const scene = document.createElement("om-scene") as OmScene;
    scene.engineFactory = () =>
      new NullEngine({
        renderWidth: 200,
        renderHeight: 200,
        textureSize: 128,
        deterministicLockstep: false,
        lockstepMaxSteps: 1,
      });
    document.body.appendChild(scene);
    teardowns.push(() => scene.remove());
    await scene.updateComplete;

    const edge = document.createElement("om-edge") as OmEdge;
    edge.path = [
      [0, 0],
      [10, 0],
    ];
    scene.appendChild(edge);
    await edge.updateComplete;
    const meshes = edge.edgeMesh;
    edge.remove();
    expect(meshes?.line.isDisposed()).toBe(true);
    expect(meshes?.hitArea.isDisposed()).toBe(true);
  });
});
