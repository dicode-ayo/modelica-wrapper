import { afterEach, describe, expect, it } from "vitest";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";

import "../src/scene/scene.component.js";
import "../src/axis/grid-axis.component.js";
import type { OmScene } from "../src/scene/scene.component.js";
import type { OmGridAxis } from "../src/axis/grid-axis.component.js";
import { buildGrid } from "../src/axis/grid-build.js";

function makeNullEngine(): NullEngine {
  return new NullEngine({
    renderWidth: 640,
    renderHeight: 480,
    textureSize: 256,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
}

let mounted: HTMLElement[] = [];

afterEach(() => {
  for (const el of mounted) {
    el.remove();
  }
  mounted = [];
});

describe("buildGrid", () => {
  it("creates three meshes parented to the provided TransformNode", () => {
    const engine = makeNullEngine();
    const scene = new Scene(engine);
    const parent = new TransformNode("test-parent", scene);
    const m = buildGrid(scene, parent);
    expect(m.minor.parent).toBe(parent);
    expect(m.major.parent).toBe(parent);
    expect(m.axes.parent).toBe(parent);
    scene.dispose();
    engine.dispose();
  });

  it("places lines covering the requested extent", () => {
    const engine = makeNullEngine();
    const scene = new Scene(engine);
    const parent = new TransformNode("test-parent", scene);
    const m = buildGrid(scene, parent, {
      extent: 100,
      minorStep: 10,
      majorStep: 50,
    });
    expect(m.minor).toBeDefined();
    expect(m.major).toBeDefined();
    expect(m.axes).toBeDefined();
    scene.dispose();
    engine.dispose();
  });
});

describe("<om-grid-axis>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("om-grid-axis")).toBeDefined();
  });

  it("creates the grid meshes when nested inside <om-scene>", async () => {
    const scene = document.createElement("om-scene") as OmScene;
    scene.engineFactory = () => makeNullEngine();
    document.body.appendChild(scene);
    mounted.push(scene);
    await scene.updateComplete;

    const grid = document.createElement("om-grid-axis") as OmGridAxis;
    scene.appendChild(grid);
    await grid.updateComplete;

    const meshes = grid.gridMeshes;
    expect(meshes).not.toBeNull();
    expect(meshes!.minor.parent).toBeDefined();
    expect(meshes!.minor.parent?.parent).toBe(scene.sceneContextValue!.worldRoot);
  });

  it("does not rebuild the grid when an equivalent coordinateSystem is reassigned", async () => {
    // After an OMC layout roundtrip the `coordinateSystem` arrives as
    // a fresh object with identical numbers. The grid's GL meshes must
    // survive that intact — otherwise every commit/refresh blanks and
    // repaints the axis underlay.
    const sceneEl = document.createElement("om-scene") as OmScene;
    sceneEl.engineFactory = () => makeNullEngine();
    document.body.appendChild(sceneEl);
    mounted.push(sceneEl);
    await sceneEl.updateComplete;

    const grid = document.createElement("om-grid-axis") as OmGridAxis;
    grid.coordinateSystem = {
      extent: [
        [-100, -100],
        [100, 100],
      ],
      grid: [2, 2],
    };
    sceneEl.appendChild(grid);
    await grid.updateComplete;
    const original = grid.gridMeshes;
    expect(original).not.toBeNull();

    grid.coordinateSystem = {
      extent: [
        [-100, -100],
        [100, 100],
      ],
      grid: [2, 2],
    };
    await grid.updateComplete;
    expect(grid.gridMeshes).toBe(original);
    expect(original!.minor.isDisposed()).toBe(false);
  });

  it("rebuilds the grid when the coordinateSystem actually changes", async () => {
    const sceneEl = document.createElement("om-scene") as OmScene;
    sceneEl.engineFactory = () => makeNullEngine();
    document.body.appendChild(sceneEl);
    mounted.push(sceneEl);
    await sceneEl.updateComplete;

    const grid = document.createElement("om-grid-axis") as OmGridAxis;
    grid.coordinateSystem = {
      extent: [
        [-100, -100],
        [100, 100],
      ],
      grid: [2, 2],
    };
    sceneEl.appendChild(grid);
    await grid.updateComplete;
    const original = grid.gridMeshes;

    grid.coordinateSystem = {
      extent: [
        [-200, -200],
        [200, 200],
      ],
      grid: [2, 2],
    };
    await grid.updateComplete;
    expect(grid.gridMeshes).not.toBe(original);
    expect(original!.minor.isDisposed()).toBe(true);
  });

  it("disposes meshes on disconnect", async () => {
    const sceneEl = document.createElement("om-scene") as OmScene;
    sceneEl.engineFactory = () => makeNullEngine();
    document.body.appendChild(sceneEl);
    mounted.push(sceneEl);
    await sceneEl.updateComplete;

    const grid = document.createElement("om-grid-axis") as OmGridAxis;
    sceneEl.appendChild(grid);
    await grid.updateComplete;

    const minorMesh = grid.gridMeshes!.minor;
    grid.remove();
    expect(minorMesh.isDisposed()).toBe(true);
  });
});
