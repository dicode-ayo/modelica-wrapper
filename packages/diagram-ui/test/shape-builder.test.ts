import { afterEach, describe, expect, it } from "vitest";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
import type { IconLayer } from "@modelica-wrapper/omc-client";

import {
  buildShapeMeshes,
  triangulate,
} from "../src/base/shape-builder.js";

const teardowns: Array<() => void> = [];

function makeScene(): { scene: Scene; parent: TransformNode } {
  const engine = new NullEngine({
    renderWidth: 200,
    renderHeight: 200,
    textureSize: 128,
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

describe("triangulate", () => {
  it("returns a single triangle for a 3-vertex polygon", () => {
    const tri = triangulate([
      [0, 0],
      [10, 0],
      [5, 10],
    ]);
    expect(tri).toHaveLength(3);
  });

  it("triangulates a convex quad into 2 triangles", () => {
    const tri = triangulate([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    expect(tri).toHaveLength(6);
  });

  it("handles clockwise input by reversing the walk", () => {
    const tri = triangulate([
      [0, 10],
      [10, 10],
      [10, 0],
      [0, 0],
    ]);
    expect(tri).toHaveLength(6);
  });

  it("returns [] for degenerate input", () => {
    expect(triangulate([])).toEqual([]);
    expect(triangulate([[0, 0]])).toEqual([]);
    expect(triangulate([[0, 0], [1, 1]])).toEqual([]);
  });
});

describe("buildShapeMeshes", () => {
  it("builds one root TransformNode parented to the supplied parent", () => {
    const { scene, parent } = makeScene();
    const group = buildShapeMeshes(scene, parent, [], undefined, "test");
    expect(group.root.parent).toBe(parent);
    group.dispose();
  });

  it("creates filled + stroke meshes for a rectangle", () => {
    const { scene, parent } = makeScene();
    const layers: IconLayer[] = [
      {
        from: "T",
        shapes: [
          {
            kind: "rectangle",
            extent: [[-10, -10], [10, 10]],
            fillColor: [255, 0, 0],
            lineColor: [0, 0, 0],
          },
        ],
      },
    ];
    const before = scene.meshes.length;
    const group = buildShapeMeshes(scene, parent, layers, undefined, "rect");
    expect(scene.meshes.length).toBeGreaterThan(before);
    group.dispose();
    expect(scene.meshes.length).toBe(before);
  });

  it("creates a polyline mesh for a line shape", () => {
    const { scene, parent } = makeScene();
    const layers: IconLayer[] = [
      {
        from: "T",
        shapes: [
          {
            kind: "line",
            points: [
              [-10, 0],
              [10, 0],
            ],
            color: [0, 0, 0],
          },
        ],
      },
    ];
    const group = buildShapeMeshes(scene, parent, layers, undefined, "line");
    // Line builder adds one mesh.
    const owned = group.root.getChildMeshes(true);
    expect(owned.length).toBeGreaterThan(0);
    group.dispose();
  });

  it("triangulates a polygon and emits a fill + stroke", () => {
    const { scene, parent } = makeScene();
    const layers: IconLayer[] = [
      {
        from: "T",
        shapes: [
          {
            kind: "polygon",
            points: [
              [-100, -100],
              [-100, 100],
              [100, 0],
              [-100, -100],
            ],
            lineColor: [0, 0, 127],
            fillColor: [255, 255, 255],
          },
        ],
      },
    ];
    const group = buildShapeMeshes(scene, parent, layers, undefined, "poly");
    const owned = group.root.getChildMeshes(true);
    // Filled triangle mesh + stroke polyline mesh.
    expect(owned.length).toBe(2);
    group.dispose();
  });

  it("emits a textured plane for a text shape", () => {
    const { scene, parent } = makeScene();
    const layers: IconLayer[] = [
      {
        from: "T",
        shapes: [
          {
            kind: "text",
            extent: [[-50, -10], [50, 10]],
            textString: "Hello",
          },
        ],
      },
    ];
    const group = buildShapeMeshes(scene, parent, layers, undefined, "text");
    const owned = group.root.getChildMeshes(true);
    expect(owned.length).toBe(1);
    group.dispose();
  });
});
