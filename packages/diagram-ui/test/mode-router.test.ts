import { describe, expect, it } from "vitest";
import { NullEngine, Node, Scene, TransformNode } from "@babylonjs/core";

import { ModeRouter } from "../src/interaction/mode.js";
import { InteractionStateStore } from "../src/interaction/interaction-state.js";

function portMesh(scene: Scene, connectorId: string): TransformNode {
  const conn = new TransformNode(`om-connector:${connectorId}`, scene);
  const port = new TransformNode("om-port-indicator", scene);
  port.parent = conn;
  port.metadata = { kind: "port" };
  return port;
}

interface Harness {
  canvas: HTMLCanvasElement;
  router: ModeRouter;
  store: InteractionStateStore;
  calls: string[];
  scene: Scene;
  setPicked: (n: Node | null) => void;
  dispose: () => void;
}

function setup(): Harness {
  const engine = new NullEngine({
    renderWidth: 100,
    renderHeight: 100,
    textureSize: 64,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  const scene = new Scene(engine);
  let picked: Node | null = null;
  const calls: string[] = [];
  const store = new InteractionStateStore();
  const canvas = document.createElement("canvas");
  const router = new ModeRouter({
    canvas,
    picker: () => picked,
    clientToDiagram: (cx, cy) => ({ x: cx, y: cy }),
    getSelectionKeys: () => [],
    onInteraction: () => calls.push("interaction"),
    onDrag: () => calls.push("drag"),
    store,
    scene,
    overlayParent: new TransformNode("overlay-root", scene),
    connectorPosition: () => null,
    evaluateCompat: () => null,
    getDrawKind: () => null,
  });
  return {
    canvas,
    router,
    store,
    calls,
    scene,
    setPicked: (n) => (picked = n),
    dispose: () => {
      router.destroy();
      scene.dispose();
      engine.dispose();
    },
  };
}

const down = (opts: PointerEventInit = {}) =>
  new PointerEvent("pointerdown", {
    button: 0,
    clientX: 5,
    clientY: 5,
    ...opts,
  });
const up = () =>
  new PointerEvent("pointerup", { button: 0, clientX: 5, clientY: 5 });

describe("ModeRouter", () => {
  it("transitions to select on an empty-space press and back to idle on release", () => {
    const { canvas, store, dispose } = setup();
    canvas.dispatchEvent(down());
    expect(store.value.mode).toBe("select");
    canvas.dispatchEvent(up());
    expect(store.value.mode).toBe("idle");
    dispose();
  });

  it("transitions to drag on a component press", () => {
    const { canvas, store, scene, setPicked, dispose } = setup();
    setPicked(new TransformNode("om-component:R1", scene));
    canvas.dispatchEvent(down());
    expect(store.value.mode).toBe("drag");
    dispose();
  });

  it("transitions to connect on a port press", () => {
    const { canvas, store, scene, setPicked, dispose } = setup();
    setPicked(portMesh(scene, "p"));
    canvas.dispatchEvent(down());
    expect(store.value.mode).toBe("connect");
    dispose();
  });

  it("runs the InteractionManager always, before the gesture (hover-before-drag order)", () => {
    const { canvas, calls, scene, setPicked, dispose } = setup();
    // A port press makes the InteractionManager emit `select` and
    // ConnectMode emit `connection`; the interaction one must come first.
    setPicked(portMesh(scene, "p"));
    canvas.dispatchEvent(down());
    expect(calls).toEqual(["interaction", "drag"]);
    dispose();
  });

  it("reports a gesture as active only between press and release", () => {
    const { canvas, router, dispose } = setup();
    expect(router.isGestureActive()).toBe(false);
    canvas.dispatchEvent(down());
    expect(router.isGestureActive()).toBe(true);
    canvas.dispatchEvent(up());
    expect(router.isGestureActive()).toBe(false);
    dispose();
  });

  it("ignores shift+primary (the pan modifier) — no gesture starts", () => {
    const { canvas, store, router, dispose } = setup();
    canvas.dispatchEvent(down({ shiftKey: true }));
    expect(router.isGestureActive()).toBe(false);
    expect(store.value.mode).toBe("idle");
    dispose();
  });

  it("stops forwarding once destroyed", () => {
    const { canvas, router, store, dispose } = setup();
    router.destroy();
    canvas.dispatchEvent(down());
    expect(store.value.mode).toBe("idle");
    expect(router.isGestureActive()).toBe(false);
    dispose();
  });

  it("ignores moves from a different pointerId mid-gesture", () => {
    const { canvas, calls, scene, setPicked, dispose } = setup();
    setPicked(new TransformNode("om-component:R1", scene));
    canvas.dispatchEvent(down({ pointerId: 1 }));
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: 2, clientX: 9, clientY: 9 }),
    );
    expect(calls.filter((c) => c === "drag")).toHaveLength(0);
    dispose();
  });

  it("clears the gesture on pointercancel", () => {
    const { canvas, router, store, scene, setPicked, dispose } = setup();
    setPicked(new TransformNode("om-component:R1", scene));
    canvas.dispatchEvent(down());
    expect(router.isGestureActive()).toBe(true);
    canvas.dispatchEvent(
      new PointerEvent("pointercancel", {
        pointerId: 0,
        clientX: 5,
        clientY: 5,
      }),
    );
    expect(router.isGestureActive()).toBe(false);
    expect(store.value.mode).toBe("idle");
    dispose();
  });
});
