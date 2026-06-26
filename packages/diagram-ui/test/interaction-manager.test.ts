import { describe, expect, it } from "vitest";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
import type { Node } from "@babylonjs/core";

import {
  InteractionManager,
  type InteractionEvents,
} from "../src/interaction/interaction-manager.js";

/** Drive the listener-free InteractionManager from dispatched events. */
function wireInteraction(
  canvas: HTMLCanvasElement,
  m: InteractionManager,
): void {
  canvas.addEventListener("pointermove", (e) => m.handlePointerMove(e));
  canvas.addEventListener("pointerdown", (e) => m.handlePointerDown(e));
  canvas.addEventListener("pointerup", (e) => m.handlePointerUp(e));
  canvas.addEventListener("pointerleave", () => m.handlePointerLeave());
}

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

interface CapturedEvent<K extends keyof InteractionEvents> {
  type: K;
  detail: InteractionEvents[K];
}

function captureEmits(): {
  emit: <K extends keyof InteractionEvents>(
    t: K,
    d: InteractionEvents[K],
  ) => void;
  events: CapturedEvent<keyof InteractionEvents>[];
} {
  const events: CapturedEvent<keyof InteractionEvents>[] = [];
  return {
    events,
    emit: <K extends keyof InteractionEvents>(
      type: K,
      detail: InteractionEvents[K],
    ) => {
      events.push({ type, detail } as CapturedEvent<keyof InteractionEvents>);
    },
  };
}

describe("InteractionManager", () => {
  it("emits hover with the picked entity key when the pointer moves over an entity", () => {
    const canvas = makeCanvas();
    const { scene, dispose } = makeScene();
    const tn = new TransformNode("om-component:foo", scene);
    const { emit, events } = captureEmits();
    const picker = (_x: number, _y: number): Node | null => tn;
    const mgr = new InteractionManager(picker, emit);
    wireInteraction(canvas, mgr);

    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 10, clientY: 10 }),
    );
    expect(events).toEqual([{ type: "hover", detail: { key: "c:foo" } }]);
    dispose();
    canvas.remove();
  });

  it("does not re-emit hover when the key doesn't change", () => {
    const canvas = makeCanvas();
    const { scene, dispose } = makeScene();
    const tn = new TransformNode("om-component:foo", scene);
    const { emit, events } = captureEmits();
    const mgr = new InteractionManager(() => tn, emit);
    wireInteraction(canvas, mgr);

    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 10, clientY: 10 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 12, clientY: 12 }),
    );
    expect(events).toHaveLength(1);
    dispose();
    canvas.remove();
  });

  it("emits select on primary-button pointerdown", () => {
    const canvas = makeCanvas();
    const { scene, dispose } = makeScene();
    const tn = new TransformNode("om-connector:p", scene);
    const { emit, events } = captureEmits();
    const mgr = new InteractionManager(() => tn, emit);
    wireInteraction(canvas, mgr);

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        clientX: 5,
        clientY: 5,
      }),
    );
    expect(events).toEqual([
      { type: "select", detail: { key: "k:p", addToSelection: false } },
    ]);
    dispose();
    canvas.remove();
  });

  it("does NOT emit select when a resize/rotate handle is picked", () => {
    const canvas = makeCanvas();
    const { scene, dispose } = makeScene();
    const { emit, events } = captureEmits();
    for (const kind of ["handle", "rotate-handle"] as const) {
      const handle = new TransformNode(`om-${kind}`, scene);
      handle.metadata = { kind, nodeId: "tl" };
      const mgr = new InteractionManager(() => handle, emit);
      wireInteraction(canvas, mgr);
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { button: 0, clientX: 5, clientY: 5 }),
      );
    }
    expect(events).toHaveLength(0);
    dispose();
    canvas.remove();
  });

  it("shift+primary down DOES NOT emit select (pan modifier)", () => {
    const canvas = makeCanvas();
    const { scene, dispose } = makeScene();
    const tn = new TransformNode("om-component:R1", scene);
    const { emit, events } = captureEmits();
    const mgr = new InteractionManager(() => tn, emit);
    wireInteraction(canvas, mgr);

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        shiftKey: true,
        clientX: 5,
        clientY: 5,
      }),
    );
    expect(events).toHaveLength(0);
    dispose();
    canvas.remove();
  });

  it("emits doubleClick on a second select within the window", () => {
    const canvas = makeCanvas();
    const { scene, dispose } = makeScene();
    const tn = new TransformNode("om-component:R1", scene);
    const { emit, events } = captureEmits();
    const mgr = new InteractionManager(() => tn, emit, {
      doubleClickMs: 1000,
    });
    wireInteraction(canvas, mgr);

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 0, clientY: 0 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 0, clientY: 0 }),
    );
    const types = events.map((e) => e.type);
    expect(types).toEqual(["select", "select", "doubleClick"]);
    dispose();
    canvas.remove();
  });

  it("emits contextMenu on secondary-button pointerup", () => {
    const canvas = makeCanvas();
    const { scene, dispose } = makeScene();
    const tn = new TransformNode("om-component:R1", scene);
    const { emit, events } = captureEmits();
    const mgr = new InteractionManager(() => tn, emit);
    wireInteraction(canvas, mgr);

    canvas.dispatchEvent(
      new PointerEvent("pointerup", { button: 2, clientX: 50, clientY: 60 }),
    );
    expect(events).toEqual([
      {
        type: "contextMenu",
        detail: { key: "c:R1", clientX: 50, clientY: 60 },
      },
    ]);
    dispose();
    canvas.remove();
  });

  it("hovering a vertex dot reports the owner shape, but pressing it still selects nothing", () => {
    const canvas = makeCanvas();
    const { scene, dispose } = makeScene();
    const shape = new TransformNode("om-shape:line:1", scene);
    const dot = new TransformNode("om-vertex-handle", scene);
    dot.metadata = { kind: "vertex-handle", nodeId: "0" };
    dot.parent = shape;
    const { emit, events } = captureEmits();
    const mgr = new InteractionManager(() => dot, emit);
    wireInteraction(canvas, mgr);

    // Hover resolves to the owner so the dots don't flicker out under the cursor.
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 10, clientY: 10 }),
    );
    // Press is still a no-op for selection — the dot belongs to DragMode.
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 10, clientY: 10 }),
    );
    expect(events).toEqual([
      { type: "hover", detail: { key: "shape:line:1" } },
    ]);
    dispose();
    canvas.remove();
  });
});
