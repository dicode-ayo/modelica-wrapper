/**
 * Headless coverage for `<om-rectangle>`'s fill routing — the branch that
 * picks the textured polygon path for rounded corners and the textured quad
 * path for sharp ones, and emits no fill mesh at all when the pattern is
 * `None`. Under `NullEngine` the baked texture can't run (`getContext()` is
 * null), so these pin the routing decisions that survive headless: which fill
 * mesh exists and whether it carries the bbox-derived UVs the texture path
 * requires.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  NullEngine,
  Scene,
  TransformNode,
  VertexBuffer,
} from "@babylonjs/core";
import type { RectangleShape } from "@dicode/omc-client";

import { OmRectangle } from "../src/primitives/rectangle.component.js";

class TestRectangle extends OmRectangle {
  buildMeshesAt(parent: TransformNode, z: number): void {
    this.buildMeshes(parent, z);
  }
}

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

const FILL: [number, number, number] = [192, 192, 192];
const LINE: [number, number, number] = [64, 64, 64];
const EXTENT: [[number, number], [number, number]] = [
  [-10, -5],
  [10, 5],
];

function buildRect(parent: TransformNode, shape: RectangleShape) {
  const el = new TestRectangle();
  el.shape = shape;
  el.buildMeshesAt(parent, 0);
  teardowns.push(() => el.disconnectedCallback());
  return el;
}

const FILL_MESH = "om-rectangle.0.fill";

function fillUv(scene: Scene): Float32Array | number[] | null {
  return (
    scene.getMeshByName(FILL_MESH)?.getVerticesData(VertexBuffer.UVKind) ?? null
  );
}

describe("<om-rectangle> fill routing", () => {
  it("routes a rounded gradient rectangle through the textured polygon path with UVs", () => {
    const { scene, parent } = makeScene();
    buildRect(parent, {
      kind: "rectangle",
      extent: EXTENT,
      fillColor: FILL,
      lineColor: LINE,
      fillPattern: "HorizontalCylinder",
      pattern: "Solid",
      radius: 3,
    });
    expect(scene.getMeshByName(FILL_MESH)).not.toBeNull();
    expect(fillUv(scene)).not.toBeNull();
  });

  it("routes a sharp gradient rectangle through the textured quad path with per-corner UVs", () => {
    const { scene, parent } = makeScene();
    buildRect(parent, {
      kind: "rectangle",
      extent: EXTENT,
      fillColor: FILL,
      lineColor: LINE,
      fillPattern: "HorizontalCylinder",
      pattern: "Solid",
    });
    // 4 corners × 2 components.
    expect(fillUv(scene)?.length).toBe(8);
  });

  it("routes a sharp hatch rectangle through the textured quad path with per-corner UVs", () => {
    const { scene, parent } = makeScene();
    buildRect(parent, {
      kind: "rectangle",
      extent: EXTENT,
      fillColor: FILL,
      lineColor: LINE,
      fillPattern: "Forward",
      pattern: "Solid",
    });
    expect(fillUv(scene)?.length).toBe(8);
  });

  it("emits no fill mesh for a None pattern, leaving only the outline", () => {
    const { scene, parent } = makeScene();
    buildRect(parent, {
      kind: "rectangle",
      extent: EXTENT,
      fillColor: FILL,
      lineColor: LINE,
      fillPattern: "None",
      pattern: "Solid",
    });
    expect(scene.getMeshByName(FILL_MESH)).toBeNull();
  });
});
