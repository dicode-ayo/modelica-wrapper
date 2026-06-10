import { describe, expect, it } from "vitest";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";

import {
  DragController,
  type DragEvents,
} from "../src/interaction/drag-controller.js";

function makeCanvas(width = 800, height = 400): HTMLCanvasElement {
  const c = document.createElement("canvas");
  document.body.appendChild(c);
  c.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    }) as DOMRect;
  return c;
}

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

interface CapturedEvent<K extends keyof DragEvents> {
  type: K;
  detail: DragEvents[K];
}

function setupController(
  picker: (cx: number, cy: number) => import("@babylonjs/core").Node | null,
): {
  canvas: HTMLCanvasElement;
  events: CapturedEvent<keyof DragEvents>[];
  cleanup: () => void;
} {
  const canvas = makeCanvas();
  const events: CapturedEvent<keyof DragEvents>[] = [];
  const controller = new DragController(
    canvas,
    picker,
    (cx, cy) => ({ x: cx, y: cy }),
    () => [],
    <K extends keyof DragEvents>(type: K, detail: DragEvents[K]) => {
      events.push({ type, detail } as CapturedEvent<keyof DragEvents>);
    },
  );
  return {
    canvas,
    events,
    cleanup: () => {
      controller.destroy();
      canvas.remove();
    },
  };
}

describe("rotate handle → rotate event", () => {
  it("emits a single clockwise rotate for the owning shape on pointerdown", () => {
    const { scene, dispose } = makeScene();
    const ownerTn = new TransformNode("om-component:R1", scene);
    const rotateMesh = new TransformNode("om-rotate-handle", scene);
    rotateMesh.parent = ownerTn;
    rotateMesh.metadata = { kind: "rotate-handle", nodeId: "rotate" };

    const { canvas, events, cleanup } = setupController(() => rotateMesh);

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 40, clientY: 10 }),
    );

    const rotates = events.filter((e) => e.type === "rotate");
    expect(rotates).toHaveLength(1);
    expect(rotates[0]!.detail).toEqual({ key: "c:R1", cw: true });
    cleanup();
    dispose();
  });

  it("does not start a drag — no further events fire on move/up", () => {
    const { scene, dispose } = makeScene();
    const ownerTn = new TransformNode("om-component:R1", scene);
    const rotateMesh = new TransformNode("om-rotate-handle", scene);
    rotateMesh.parent = ownerTn;
    rotateMesh.metadata = { kind: "rotate-handle", nodeId: "rotate" };

    const { canvas, events, cleanup } = setupController(() => rotateMesh);

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 40, clientY: 10 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 60, clientY: 30 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, clientX: 60, clientY: 30 }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("rotate");
    cleanup();
    dispose();
  });
});
