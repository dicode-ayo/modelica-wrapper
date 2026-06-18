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

function makePortMesh(scene: Scene, connectorId: string): TransformNode {
  const conn = new TransformNode(`om-connector:${connectorId}`, scene);
  const port = new TransformNode("om-port-indicator", scene);
  port.parent = conn;
  port.metadata = { kind: "port" };
  return port;
}

function makeConnectorMesh(scene: Scene, connectorId: string): TransformNode {
  return new TransformNode(`om-connector:${connectorId}`, scene);
}

describe("DragController — connection drag", () => {
  it("emits connection events while dragging from a port", () => {
    const { scene, dispose } = makeScene();
    const sourcePort = makePortMesh(scene, "p");
    const canvas = makeCanvas();
    const events: { type: keyof DragEvents; detail: unknown }[] = [];
    const picked: TransformNode | null = sourcePort;
    const controller = new DragController(
      canvas,
      () => picked,
      (cx, cy) => ({ x: cx, y: cy }),
      () => [],
      (type, detail) => {
        events.push({ type, detail });
      },
    );

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 0, clientY: 0 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 50, clientY: 30 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, clientX: 50, clientY: 30 }),
    );

    const conn = events.filter((e) => e.type === "connection");
    expect(conn).toHaveLength(3);
    const last = conn[conn.length - 1]!.detail as DragEvents["connection"];
    expect(last.from).toBe("k:p");
    expect(last.commit).toBe(true);
    expect(last.to).toEqual({ x: 50, y: 30 });

    controller.destroy();
    canvas.remove();
    dispose();
  });

  it("populates toKey when the drag ends over another connector", () => {
    const { scene, dispose } = makeScene();
    const sourcePort = makePortMesh(scene, "out");
    const targetConn = makeConnectorMesh(scene, "in");
    const canvas = makeCanvas();
    const events: DragEvents["connection"][] = [];
    let picked: TransformNode | null = sourcePort;
    const controller = new DragController(
      canvas,
      () => picked,
      (cx, cy) => ({ x: cx, y: cy }),
      () => [],
      (type, detail) => {
        if (type === "connection") {
          events.push(detail as DragEvents["connection"]);
        }
      },
    );

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 0, clientY: 0 }),
    );
    // Move cursor over the target connector by switching what the picker returns.
    picked = targetConn;
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 80, clientY: 0 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, clientX: 80, clientY: 0 }),
    );

    const last = events[events.length - 1]!;
    expect(last.commit).toBe(true);
    expect(last.toKey).toBe("k:in");

    controller.destroy();
    canvas.remove();
    dispose();
  });

  it("toKey stays null when the cursor leaves onto empty space", () => {
    const { scene, dispose } = makeScene();
    const sourcePort = makePortMesh(scene, "self");
    const canvas = makeCanvas();
    const events: DragEvents["connection"][] = [];
    let picked: TransformNode | null = sourcePort;
    const controller = new DragController(
      canvas,
      () => picked,
      (cx, cy) => ({ x: cx, y: cy }),
      () => [],
      (type, detail) => {
        if (type === "connection") {
          events.push(detail as DragEvents["connection"]);
        }
      },
    );

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 0, clientY: 0 }),
    );
    // Stay on the source connector — should NOT snap to self.
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 10, clientY: 0 }),
    );
    // Move off into empty space — picker returns null.
    picked = null;
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 200, clientY: 0 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, clientX: 200, clientY: 0 }),
    );

    const last = events[events.length - 1]!;
    expect(last.toKey).toBeNull();

    controller.destroy();
    canvas.remove();
    dispose();
  });

  it("tracks the live cursor position on each move while connecting", () => {
    const { scene, dispose } = makeScene();
    const sourcePort = makePortMesh(scene, "p");
    const canvas = makeCanvas();
    const events: DragEvents["connection"][] = [];
    const picked: TransformNode | null = sourcePort;
    const controller = new DragController(
      canvas,
      () => picked,
      (cx, cy) => ({ x: cx, y: cy }),
      () => [],
      (type, detail) => {
        if (type === "connection") {
          events.push(detail as DragEvents["connection"]);
        }
      },
    );

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 0, clientY: 0 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 30, clientY: 10 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 60, clientY: 40 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, clientX: 60, clientY: 40 }),
    );

    const tos = events.map((e) => e.to);
    expect(tos).toContainEqual({ x: 30, y: 10 });
    expect(tos).toContainEqual({ x: 60, y: 40 });

    controller.destroy();
    canvas.remove();
    dispose();
  });

  it("snaps toKey to a target then clears it when the cursor leaves", () => {
    const { scene, dispose } = makeScene();
    const sourcePort = makePortMesh(scene, "out");
    const targetConn = makeConnectorMesh(scene, "in");
    const canvas = makeCanvas();
    const events: DragEvents["connection"][] = [];
    let picked: TransformNode | null = sourcePort;
    const controller = new DragController(
      canvas,
      () => picked,
      (cx, cy) => ({ x: cx, y: cy }),
      () => [],
      (type, detail) => {
        if (type === "connection") {
          events.push(detail as DragEvents["connection"]);
        }
      },
    );

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 0, clientY: 0 }),
    );
    picked = targetConn;
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 80, clientY: 0 }),
    );
    const overTarget = events[events.length - 1]!;
    picked = null;
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 200, clientY: 0 }),
    );
    const overEmpty = events[events.length - 1]!;
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, clientX: 200, clientY: 0 }),
    );

    expect(overTarget.toKey).toBe("k:in");
    expect(overEmpty.toKey).toBeNull();

    controller.destroy();
    canvas.remove();
    dispose();
  });

  it("toKey stays null when released back on the source connector", () => {
    const { scene, dispose } = makeScene();
    const sourcePort = makePortMesh(scene, "self");
    const sourceConn = makeConnectorMesh(scene, "self");
    const canvas = makeCanvas();
    const events: DragEvents["connection"][] = [];
    let picked: TransformNode | null = sourcePort;
    const controller = new DragController(
      canvas,
      () => picked,
      (cx, cy) => ({ x: cx, y: cy }),
      () => [],
      (type, detail) => {
        if (type === "connection") {
          events.push(detail as DragEvents["connection"]);
        }
      },
    );

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 0, clientY: 0 }),
    );
    // Land the release back on the source's own connector — must not
    // snap to self.
    picked = sourceConn;
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 5, clientY: 0 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, clientX: 5, clientY: 0 }),
    );

    const last = events[events.length - 1]!;
    expect(last.toKey).toBeNull();

    controller.destroy();
    canvas.remove();
    dispose();
  });
});
