import { describe, expect, it } from "vitest";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";

import {
  buildWireMesh,
  buildRectMesh,
  disposeOverlayMesh,
  CONNECT_OK_COLOR,
} from "../src/base/overlay-mesh.js";

function makeScene(): {
  scene: Scene;
  parent: TransformNode;
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
  const parent = new TransformNode("root", scene);
  return {
    scene,
    parent,
    dispose: () => {
      scene.dispose();
      engine.dispose();
    },
  };
}

describe("overlay-mesh", () => {
  it("buildWireMesh builds the wire without its pick tube", () => {
    const { scene, parent, dispose } = makeScene();

    const wire = buildWireMesh(
      scene,
      parent,
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      CONNECT_OK_COLOR,
    );

    expect(wire).not.toBeNull();
    expect(scene.getMeshByName("om-gesture-wire")).not.toBeNull();
    // The pick tube is feedback-only; it must not linger.
    expect(scene.getMeshByName("om-gesture-wire.hit")).toBeNull();
    dispose();
  });

  it("disposeOverlayMesh removes the mesh and tolerates null", () => {
    const { scene, parent, dispose } = makeScene();

    const wire = buildWireMesh(
      scene,
      parent,
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      CONNECT_OK_COLOR,
    );
    disposeOverlayMesh(wire);
    expect(scene.getMeshByName("om-gesture-wire")).toBeNull();

    expect(() => disposeOverlayMesh(null)).not.toThrow();
    dispose();
  });

  it("buildRectMesh builds the rubber-band outline", () => {
    const { scene, parent, dispose } = makeScene();

    const rect = buildRectMesh(scene, parent, { x1: 0, y1: 0, x2: 10, y2: 10 });

    expect(rect).not.toBeNull();
    expect(scene.getMeshByName("om-rubber-band")).not.toBeNull();
    disposeOverlayMesh(rect);
    expect(scene.getMeshByName("om-rubber-band")).toBeNull();
    dispose();
  });

  it("does not accrue materials across repeated builds", () => {
    const { scene, parent, dispose } = makeScene();

    let wire = buildWireMesh(
      scene,
      parent,
      { x: 0, y: 0 },
      { x: 4, y: 1 },
      CONNECT_OK_COLOR,
    );
    for (let i = 2; i <= 3; i++) {
      disposeOverlayMesh(wire);
      wire = buildWireMesh(
        scene,
        parent,
        { x: 0, y: 0 },
        { x: i * 4, y: i },
        CONNECT_OK_COLOR,
      );
    }
    const afterThree = scene.materials.length;
    for (let i = 4; i <= 8; i++) {
      disposeOverlayMesh(wire);
      wire = buildWireMesh(
        scene,
        parent,
        { x: 0, y: 0 },
        { x: i * 4, y: i },
        CONNECT_OK_COLOR,
      );
    }
    // Each build releases the previous material, so more builds must not
    // grow the material count.
    expect(scene.materials.length).toBe(afterThree);
    dispose();
  });
});
