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
    const mesh = buildEdge(s.scene, s.parent, "edge", {
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    });
    expect(mesh).not.toBeNull();
    expect(mesh!.parent).toBe(s.parent);
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
    const mesh = edge.edgeMesh;
    edge.remove();
    expect(mesh?.isDisposed()).toBe(true);
  });
});
