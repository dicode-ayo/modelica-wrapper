import { describe, expect, it } from "vitest";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";

import {
  DragController,
  type DragEvents,
} from "../src/interaction/drag-controller.js";
import { wireDrag } from "./harness/pointer-wiring.js";

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

function setupController(opts: {
  picker: (cx: number, cy: number) => import("@babylonjs/core").Node | null;
  clientToDiagram?: (cx: number, cy: number) => { x: number; y: number } | null;
  selection?: string[];
}): {
  canvas: HTMLCanvasElement;
  controller: DragController;
  events: CapturedEvent<keyof DragEvents>[];
  cleanup: () => void;
} {
  const canvas = makeCanvas();
  const events: CapturedEvent<keyof DragEvents>[] = [];
  const controller = new DragController(
    canvas,
    opts.picker,
    opts.clientToDiagram ?? ((cx, cy) => ({ x: cx, y: cy })),
    () => opts.selection ?? [],
    <K extends keyof DragEvents>(type: K, detail: DragEvents[K]) => {
      events.push({ type, detail } as CapturedEvent<keyof DragEvents>);
    },
  );
  wireDrag(canvas, controller);
  return {
    canvas,
    controller,
    events,
    cleanup: () => {
      canvas.remove();
    },
  };
}

describe("DragController", () => {
  it("emits drag events when pointer drags a component", () => {
    const { scene, dispose } = makeScene();
    const node = new TransformNode("om-component:R1", scene);
    const { canvas, events, cleanup } = setupController({
      picker: () => node,
    });

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 10, clientY: 10 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 30, clientY: 25 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, clientX: 30, clientY: 25 }),
    );

    const drags = events.filter((e) => e.type === "drag");
    expect(drags.length).toBe(2);
    expect(drags[0]!.detail).toMatchObject({
      keys: ["c:R1"],
      dx: 20,
      dy: 15,
      draft: true,
    });
    expect(drags[1]!.detail).toMatchObject({
      keys: ["c:R1"],
      dx: 20,
      dy: 15,
      draft: false,
    });

    cleanup();
    dispose();
  });

  it("drags the full selection when the clicked entity is already selected", () => {
    const { scene, dispose } = makeScene();
    const node = new TransformNode("om-component:R1", scene);
    const { canvas, events, cleanup } = setupController({
      picker: () => node,
      selection: ["c:R1", "c:C1"],
    });

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 0, clientY: 0 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 5, clientY: 5 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, clientX: 5, clientY: 5 }),
    );

    const drag = events.find((e) => e.type === "drag") as
      | CapturedEvent<"drag">
      | undefined;
    expect(drag).toBeDefined();
    expect(drag!.detail.keys.sort()).toEqual(["c:C1", "c:R1"]);
    cleanup();
    dispose();
  });

  it("emits resize events when starting on a handle mesh", () => {
    const { scene, dispose } = makeScene();
    const ownerTn = new TransformNode("om-component:R1", scene);
    const handleMesh = new TransformNode("om-handle:tl", scene);
    handleMesh.parent = ownerTn;
    handleMesh.metadata = { kind: "handle", nodeId: "tl" };

    const { canvas, events, cleanup } = setupController({
      picker: () => handleMesh,
    });

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 100, clientY: 50 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 120, clientY: 70 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, clientX: 120, clientY: 70 }),
    );

    const resizes = events.filter((e) => e.type === "resize");
    expect(resizes).toHaveLength(3); // start + move + commit
    expect(resizes[0]!.detail).toMatchObject({
      key: "c:R1",
      corner: "tl",
      draft: true,
    });
    expect(resizes[2]!.detail).toMatchObject({ draft: false });
    cleanup();
    dispose();
  });

  it("emits rubberBand on empty-space drag", () => {
    const { canvas, events, cleanup } = setupController({
      picker: () => null,
    });

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 5, clientY: 5 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 40, clientY: 30 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, clientX: 40, clientY: 30 }),
    );

    const rb = events.filter((e) => e.type === "rubberBand");
    expect(rb).toHaveLength(3);
    expect(rb[2]!.detail).toMatchObject({
      rect: { x1: 5, y1: 5, x2: 40, y2: 30 },
      draft: false,
    });
    cleanup();
  });

  it("emits edgeDrag with the grab point and cumulative delta on an edge", () => {
    const { scene, dispose } = makeScene();
    const edge = new TransformNode("om-edge:0", scene);
    edge.metadata = { kind: "edge", nodeId: "0" };
    const { canvas, events, cleanup } = setupController({
      picker: () => edge,
    });

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 100, clientY: 50 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 130, clientY: 60 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, clientX: 130, clientY: 60 }),
    );

    const edgeDrags = events.filter((e) => e.type === "edgeDrag");
    expect(edgeDrags.length).toBe(2);
    expect(edgeDrags[0]!.detail).toMatchObject({
      connIdx: 0,
      grab: { x: 100, y: 50 },
      dx: 30,
      dy: 10,
      draft: true,
    });
    expect(edgeDrags[1]!.detail).toMatchObject({ draft: false });

    cleanup();
    dispose();
  });

  it("ignores shift+primary (pan modifier)", () => {
    const { canvas, events, cleanup } = setupController({
      picker: () => null,
    });
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        shiftKey: true,
        clientX: 5,
        clientY: 5,
      }),
    );
    expect(events).toHaveLength(0);
    cleanup();
  });

  it.each(["tr", "br", "bl"] as const)(
    "emits resize on the %s handle with the matching corner",
    (corner) => {
      const { scene, dispose } = makeScene();
      const ownerTn = new TransformNode("om-component:R1", scene);
      const handleMesh = new TransformNode(`om-handle:${corner}`, scene);
      handleMesh.parent = ownerTn;
      handleMesh.metadata = { kind: "handle", nodeId: corner };

      const { canvas, events, cleanup } = setupController({
        picker: () => handleMesh,
      });

      canvas.dispatchEvent(
        new PointerEvent("pointerdown", {
          button: 0,
          clientX: 100,
          clientY: 50,
        }),
      );
      canvas.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 120, clientY: 70 }),
      );
      canvas.dispatchEvent(
        new PointerEvent("pointerup", { button: 0, clientX: 120, clientY: 70 }),
      );

      const resizes = events.filter((e) => e.type === "resize");
      expect(resizes).toHaveLength(3);
      expect(resizes[0]!.detail).toMatchObject({
        key: "c:R1",
        corner,
        draft: true,
      });
      expect(resizes[2]!.detail).toMatchObject({ draft: false });
      cleanup();
      dispose();
    },
  );

  it("emits rotate events when starting on a rotate handle", () => {
    const { scene, dispose } = makeScene();
    const ownerTn = new TransformNode("om-component:R1", scene);
    const rotateMesh = new TransformNode("om-rotate-handle", scene);
    rotateMesh.parent = ownerTn;
    rotateMesh.metadata = { kind: "rotate-handle", nodeId: "rotate" };

    const { canvas, events, cleanup } = setupController({
      picker: () => rotateMesh,
    });

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 100, clientY: 20 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 110, clientY: 10 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, clientX: 110, clientY: 10 }),
    );

    const rotates = events.filter((e) => e.type === "rotate");
    expect(rotates.length).toBeGreaterThanOrEqual(2);
    expect(rotates[0]!.detail).toMatchObject({ key: "c:R1", draft: true });
    expect(
      rotates.some((r) => (r.detail as DragEvents["rotate"]).draft === false),
    ).toBe(true);
    cleanup();
    dispose();
  });
});
