import { afterEach, describe, expect, it } from "vitest";
import {
  ArcRotateCamera,
  NullEngine,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

import "../src/scene/scene.component.js";
import "../src/connection/edge.component.js";
import type { OmScene } from "../src/scene/scene.component.js";
import type { OmEdge } from "../src/connection/edge.component.js";
import { buildEdge, updateEdgeDashes } from "../src/connection/edge-build.js";

/** Ortho camera with the given horizontal half-extent, so the scene
 *  reports a known world-per-pixel for dash-count math. */
function setOrthoCamera(scene: Scene, halfWidth: number): ArcRotateCamera {
  const cam = new ArcRotateCamera("c", 0, 0, 10, Vector3.Zero(), scene);
  cam.orthoLeft = -halfWidth;
  cam.orthoRight = halfWidth;
  cam.orthoTop = halfWidth;
  cam.orthoBottom = -halfWidth;
  scene.activeCamera = cam;
  return cam;
}

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

  it("leaves an unclocked edge undashed", () => {
    const s = makeScene();
    teardowns.push(s.dispose);
    setOrthoCamera(s.scene, 100);
    const result = buildEdge(s.scene, s.parent, "edge", {
      points: [
        [0, 0],
        [100, 0],
      ],
    });
    if (result === null) {
      throw new Error("buildEdge returned null for a valid two-point edge");
    }
    expect(result.line.greasedLineMaterial?.useDash).toBeFalsy();
  });

  it("holds a clocked edge's dash count constant in screen space", () => {
    const s = makeScene();
    teardowns.push(s.dispose);
    // renderWidth 200, halfWidth 100 → worldPerPixel = 1.
    const cam = setOrthoCamera(s.scene, 100);
    const points: [number, number][] = [
      [0, 0],
      [100, 0],
    ];
    const result = buildEdge(s.scene, s.parent, "edge", {
      points,
      clocked: true,
    });
    if (result === null) {
      throw new Error("buildEdge returned null for a valid two-point edge");
    }
    const material = result.line.greasedLineMaterial;
    if (!material) {
      throw new Error("clocked edge has no GreasedLine material");
    }
    expect(material.useDash).toBe(true);
    const atOneToOne = material.dashCount;
    expect(atOneToOne).toBeGreaterThan(0);

    // Zoom in 2× (halve the extent) → the line is twice as long on
    // screen, so the dash count doubles to keep one period the same
    // pixel length.
    cam.orthoLeft = -50;
    cam.orthoRight = 50;
    updateEdgeDashes(s.scene, result.line, points);
    expect(material.dashCount).toBeCloseTo(atOneToOne * 2, 0);
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
    // keep the same mesh, not dispose + recreate it.
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

  it("updates the line mesh in place when only point positions change", async () => {
    // Per-pointermove path shifts during a component drag must NOT
    // dispose + recreate the ribbon — that's the GPU-buffer churn we
    // want to avoid. The line stays alive and its points reflect the
    // new positions.
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
    const originalLine = edge.edgeMesh!.line;

    edge.path = [
      [0, 0],
      [60, 0],
    ];
    await edge.updateComplete;
    expect(edge.edgeMesh!.line).toBe(originalLine);
    expect(originalLine.isDisposed()).toBe(false);
    // GreasedLine exposes its backbone as `points` ([[x, y, z, …]]); the
    // second point's x should reflect the new endpoint (60).
    const points = originalLine.points[0];
    expect(points).toBeDefined();
    expect(points?.[3]).toBeCloseTo(60);
  });

  it("rebuilds the mesh when the point count changes", async () => {
    // In-place update is gated on an unchanged point count so the hit
    // tube stays in step; adding or dropping waypoints falls back to a
    // full dispose + recreate.
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
    const originalLine = edge.edgeMesh!.line;

    edge.path = [
      [0, 0],
      [50, 0],
      [50, 30],
    ];
    await edge.updateComplete;
    expect(edge.edgeMesh!.line).not.toBe(originalLine);
    expect(originalLine.isDisposed()).toBe(true);
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
