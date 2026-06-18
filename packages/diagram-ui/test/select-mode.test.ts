import { describe, expect, it } from "vitest";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";

import { SelectMode } from "../src/interaction/mode.js";

/**
 * The host's hover-suppression relies on InteractionManager being driven
 * before DragController (its hover emit must precede the drag-state
 * transition). SelectMode is the single place that ordering now lives,
 * so pin it directly with the real controllers.
 */

function makeScene(): { scene: Scene; dispose: () => void } {
  const engine = new NullEngine({
    renderWidth: 100,
    renderHeight: 100,
    textureSize: 64,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  const scene = new Scene(engine);
  return {
    scene,
    dispose: () => {
      scene.dispose();
      engine.dispose();
    },
  };
}

function portMesh(scene: Scene, connectorId: string): TransformNode {
  const conn = new TransformNode(`om-connector:${connectorId}`, scene);
  const port = new TransformNode("om-port-indicator", scene);
  port.parent = conn;
  port.metadata = { kind: "port" };
  return port;
}

describe("SelectMode", () => {
  it("forwards a pointer event to InteractionManager before DragController", () => {
    const { scene, dispose } = makeScene();
    const port = portMesh(scene, "p");
    const calls: string[] = [];
    const mode = new SelectMode({
      canvas: document.createElement("canvas"),
      picker: () => port,
      clientToDiagram: (cx, cy) => ({ x: cx, y: cy }),
      getSelectionKeys: () => [],
      onInteraction: () => calls.push("interaction"),
      onDrag: () => calls.push("drag"),
    });

    // A port pointerdown makes the InteractionManager emit `select` and
    // the DragController emit `connection` — so both callbacks fire, and
    // the interaction one must come first.
    mode.onPointerDown(
      new PointerEvent("pointerdown", { button: 0, clientX: 5, clientY: 5 }),
    );

    expect(calls).toEqual(["interaction", "drag"]);
    dispose();
  });
});
