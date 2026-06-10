import { afterEach, describe, expect, it } from "vitest";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
import type { Placement } from "@dicode/omc-client";

import { OmShapeNode } from "../src/base/shape-node.js";
import { RubberBandOverlay } from "../src/base/selection-overlay.js";

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

describe("OmShapeNode selection", () => {
  it("creates 4 resize-handle meshes on first setSelected(true)", () => {
    const { scene, parent } = makeScene();
    const node = new OmShapeNode(scene, parent);
    node.setPlacement(
      {
        extent: [
          [-10, -10],
          [10, 10],
        ],
      } as Placement,
      undefined,
    );
    node.setSelected(true);
    const handles = scene.meshes.filter((m) => m.name.startsWith("om-handle:"));
    expect(handles).toHaveLength(4);
    for (const corner of ["tl", "tr", "br", "bl"]) {
      expect(scene.getMeshByName(`om-handle:${corner}`)).toBeTruthy();
    }
  });

  it("toggles handle visibility on setSelected", () => {
    const { scene, parent } = makeScene();
    const node = new OmShapeNode(scene, parent);
    node.setPlacement(
      {
        extent: [
          [0, 0],
          [10, 10],
        ],
      } as Placement,
      undefined,
    );
    node.setSelected(true);
    const tl = scene.getMeshByName("om-handle:tl")!;
    expect(tl.isVisible).toBe(true);
    node.setSelected(false);
    expect(tl.isVisible).toBe(false);
  });

  it("setMeshHighlight is a no-op under NullEngine", async () => {
    const { scene, parent } = makeScene();
    const node = new OmShapeNode(scene, parent);
    node.setPlacement(
      {
        extent: [
          [-5, -5],
          [5, 5],
        ],
      } as Placement,
      undefined,
    );
    const { setMeshHighlight } =
      await import("../src/base/selection-overlay.js");
    // Should not throw and should not attach a HighlightLayer to the
    // scene (NullEngine has no stencil buffer).
    expect(() => setMeshHighlight(scene, node.mesh, null)).not.toThrow();
    const meta = scene.metadata as { omHighlightState?: unknown } | null;
    expect(meta?.omHighlightState).toBeUndefined();
  });

  it("disposes handles on shape-node dispose", () => {
    const { scene, parent } = makeScene();
    const node = new OmShapeNode(scene, parent);
    node.setPlacement(
      {
        extent: [
          [-5, -5],
          [5, 5],
        ],
      } as Placement,
      undefined,
    );
    node.setSelected(true);
    const tl = scene.getMeshByName("om-handle:tl")!;
    node.dispose();
    expect(tl.isDisposed()).toBe(true);
  });
});

describe("RubberBandOverlay", () => {
  it("draws a fill plane + border once the band has area", () => {
    const { scene, parent } = makeScene();
    const band = new RubberBandOverlay(scene, parent);
    band.setRect({ x1: 0, y1: 0, x2: 40, y2: 20 });
    expect(scene.getMeshByName("om-rubberband")).toBeTruthy();
    expect(scene.getMeshByName("om-rubberband-border")).toBeTruthy();
  });

  it("draws nothing for a zero-area band", () => {
    const { scene, parent } = makeScene();
    const band = new RubberBandOverlay(scene, parent);
    band.setRect({ x1: 10, y1: 10, x2: 10, y2: 10 });
    expect(scene.getMeshByName("om-rubberband")).toBeNull();
  });

  it("clears the band on setRect(null)", () => {
    const { scene, parent } = makeScene();
    const band = new RubberBandOverlay(scene, parent);
    band.setRect({ x1: 0, y1: 0, x2: 40, y2: 20 });
    band.setRect(null);
    expect(scene.getMeshByName("om-rubberband")).toBeNull();
    expect(scene.getMeshByName("om-rubberband-border")).toBeNull();
  });

  it("disposes its meshes", () => {
    const { scene, parent } = makeScene();
    const band = new RubberBandOverlay(scene, parent);
    band.setRect({ x1: 0, y1: 0, x2: 40, y2: 20 });
    band.dispose();
    expect(scene.getMeshByName("om-rubberband")).toBeNull();
  });
});
