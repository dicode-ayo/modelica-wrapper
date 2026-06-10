/**
 * Headless coverage for the gradient / hatch fill path. Babylon's
 * `DynamicTexture.getContext()` returns null under `NullEngine`, so the baked
 * texture itself can't be exercised here (it's covered visually by the
 * Storybook/Chromatic stories). These tests pin the parts that survive
 * headless:
 *  - the bbox-derived UVs the texture path requires on every filled mesh,
 *  - the flat-material fallback colour (a gradient degrades to its fill, a
 *    hatch to its background — never to a black/line rectangle),
 *  - that solid / none specs never take the texture path.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  NullEngine,
  Scene,
  StandardMaterial,
  TransformNode,
  VertexBuffer,
} from "@babylonjs/core";
import { fillSpec } from "@dicode/diagram-svg";

import {
  buildFanFromCenter,
  buildFilledPolygon,
  buildFilledQuad,
  type RectBox,
} from "../src/primitives/shape-utils.js";
import { resolveFillTexture } from "../src/primitives/fill-texture.js";

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
const BOX: RectBox = { x: -10, y: -5, width: 20, height: 10 };

const cylinder = fillSpec({
  fillColor: FILL,
  lineColor: LINE,
  pattern: "HorizontalCylinder",
});
const hatch = fillSpec({
  fillColor: FILL,
  lineColor: LINE,
  pattern: "Forward",
});
const solid = fillSpec({ fillColor: FILL, lineColor: LINE, pattern: "Solid" });

function materialOf(scene: Scene, name: string): StandardMaterial {
  const mat = scene.getMaterialByName(name);
  if (!(mat instanceof StandardMaterial)) {
    throw new Error(`material ${name} missing`);
  }
  return mat;
}

function uvOf(scene: Scene, mesh: string): Float32Array | number[] | null {
  return (
    scene.getMeshByName(mesh)?.getVerticesData(VertexBuffer.UVKind) ?? null
  );
}

describe("resolveFillTexture", () => {
  it("returns null for solid and none specs", () => {
    const { scene } = makeScene();
    expect(resolveFillTexture(scene, solid, 2)).toBeNull();
    expect(resolveFillTexture(scene, { kind: "none" }, 2)).toBeNull();
  });
});

describe("buildFilledQuad", () => {
  it("emits per-corner UVs for the fill texture", () => {
    const { scene, parent } = makeScene();
    const res = buildFilledQuad(scene, parent, BOX, cylinder, 0, "quad");
    // 4 corners × 2 components.
    expect(uvOf(scene, "quad")?.length).toBe(8);
    res.dispose();
  });

  it("falls back to a flat material in the gradient's fill colour", () => {
    const { scene, parent } = makeScene();
    const res = buildFilledQuad(scene, parent, BOX, cylinder, 0, "quad-grad");
    const mat = materialOf(scene, "quad-grad.mat");
    // No canvas headless → flat fallback, and it degrades to fill (192/255),
    // never to the black/line edge.
    expect(mat.emissiveColor.r).toBeCloseTo(192 / 255, 5);
    res.dispose();
  });

  it("hatch falls back to its background colour", () => {
    const { scene, parent } = makeScene();
    const res = buildFilledQuad(scene, parent, BOX, hatch, 0, "quad-hatch");
    const mat = materialOf(scene, "quad-hatch.mat");
    expect(mat.emissiveColor.r).toBeCloseTo(192 / 255, 5);
    res.dispose();
  });
});

describe("buildFanFromCenter", () => {
  it("emits per-vertex UVs (centre + ring) the texture path needs", () => {
    const { scene, parent } = makeScene();
    const ring: Array<[number, number]> = [
      [0, -5],
      [10, 5],
      [-10, 5],
    ];
    const res = buildFanFromCenter(
      scene,
      parent,
      0,
      0,
      ring,
      BOX,
      cylinder,
      0,
      "fan",
    );
    // centre + 3 ring vertices = 4 verts × 2 components.
    expect(uvOf(scene, "fan")?.length).toBe(8);
    res.dispose();
  });
});

describe("buildFilledPolygon", () => {
  it("emits per-vertex UVs derived from the point bbox", () => {
    const { scene, parent } = makeScene();
    const points: Array<[number, number]> = [
      [-10, -5],
      [10, -5],
      [0, 5],
    ];
    const res = buildFilledPolygon(scene, parent, points, hatch, 0, "poly");
    if (!res) throw new Error("polygon fill should build");
    expect(uvOf(scene, "poly")?.length).toBe(6);
    res.dispose();
  });
});
