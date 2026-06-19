import { describe, expect, it } from "vitest";
import { NullEngine, Node, Scene, TransformNode } from "@babylonjs/core";

import { DragMode } from "../src/interaction/drag-mode.js";
import type {
  DragEvents,
  GestureStart,
} from "../src/interaction/gesture-mode.js";
import { entityKeyForNode } from "../src/interaction/node-keys.js";

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

function setup(): {
  mode: DragMode;
  events: CapturedEvent<keyof DragEvents>[];
} {
  const events: CapturedEvent<keyof DragEvents>[] = [];
  const mode = new DragMode(
    <K extends keyof DragEvents>(type: K, detail: DragEvents[K]) => {
      events.push({ type, detail } as CapturedEvent<keyof DragEvents>);
    },
  );
  return { mode, events };
}

function start(
  node: Node | null,
  point: { x: number; y: number },
  opts: { shiftKey?: boolean; selection?: string[] } = {},
): GestureStart {
  return {
    node,
    entity: entityKeyForNode(node),
    point,
    shiftKey: opts.shiftKey ?? false,
    getSelectionKeys: () => opts.selection ?? [],
  };
}

const move = (x: number, y: number) =>
  new PointerEvent("pointermove", { clientX: x, clientY: y });

describe("DragMode", () => {
  it("emits drag events when a component is dragged", () => {
    const { scene, dispose } = makeScene();
    const node = new TransformNode("om-component:R1", scene);
    const { mode, events } = setup();

    expect(mode.begin(start(node, { x: 10, y: 10 }))).toBe(true);
    mode.update({ x: 30, y: 25 }, move(30, 25));
    mode.commit({ x: 30, y: 25 }, move(30, 25));

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
    dispose();
  });

  it("drags the full selection when the clicked entity is already selected", () => {
    const { scene, dispose } = makeScene();
    const node = new TransformNode("om-component:R1", scene);
    const { mode, events } = setup();

    mode.begin(start(node, { x: 0, y: 0 }, { selection: ["c:R1", "c:C1"] }));
    mode.update({ x: 5, y: 5 }, move(5, 5));

    const drag = events.find((e) => e.type === "drag") as
      | CapturedEvent<"drag">
      | undefined;
    expect(drag).toBeDefined();
    expect(drag!.detail.keys.sort()).toEqual(["c:C1", "c:R1"]);
    dispose();
  });

  it.each(["tl", "tr", "br", "bl"] as const)(
    "emits resize on the %s handle with the matching corner",
    (corner) => {
      const { scene, dispose } = makeScene();
      const ownerTn = new TransformNode("om-component:R1", scene);
      const handleMesh = new TransformNode(`om-handle:${corner}`, scene);
      handleMesh.parent = ownerTn;
      handleMesh.metadata = { kind: "handle", nodeId: corner };
      const { mode, events } = setup();

      mode.begin(start(handleMesh, { x: 100, y: 50 }));
      mode.update({ x: 120, y: 70 }, move(120, 70));
      mode.commit({ x: 120, y: 70 }, move(120, 70));

      const resizes = events.filter((e) => e.type === "resize");
      expect(resizes).toHaveLength(3); // start + move + commit
      expect(resizes[0]!.detail).toMatchObject({
        key: "c:R1",
        corner,
        draft: true,
      });
      expect(resizes[2]!.detail).toMatchObject({ draft: false });
      dispose();
    },
  );

  it("emits draft rotate on begin + move, then a commit", () => {
    const { scene, dispose } = makeScene();
    const ownerTn = new TransformNode("om-component:R1", scene);
    const rotateMesh = new TransformNode("om-rotate-handle", scene);
    rotateMesh.parent = ownerTn;
    rotateMesh.metadata = { kind: "rotate-handle", nodeId: "rotate" };
    const { mode, events } = setup();

    mode.begin(start(rotateMesh, { x: 40, y: 10 }));
    mode.update({ x: 60, y: 30 }, move(60, 30));
    mode.commit({ x: 60, y: 30 }, move(60, 30));

    const rotates = events.filter((e) => e.type === "rotate");
    expect(rotates.map((e) => e.detail)).toEqual([
      { key: "c:R1", x: 40, y: 10, free: false, draft: true },
      { key: "c:R1", x: 60, y: 30, free: false, draft: true },
      { key: "c:R1", x: 60, y: 30, free: false, draft: false },
    ]);
    dispose();
  });

  it("flags `free` when Shift is held during a rotate move", () => {
    const { scene, dispose } = makeScene();
    const ownerTn = new TransformNode("om-component:R1", scene);
    const rotateMesh = new TransformNode("om-rotate-handle", scene);
    rotateMesh.parent = ownerTn;
    rotateMesh.metadata = { kind: "rotate-handle", nodeId: "rotate" };
    const { mode, events } = setup();

    mode.begin(start(rotateMesh, { x: 40, y: 10 }));
    mode.update(
      { x: 60, y: 30 },
      new PointerEvent("pointermove", {
        shiftKey: true,
        clientX: 60,
        clientY: 30,
      }),
    );

    const last = events.filter((e) => e.type === "rotate").at(-1);
    if (last === undefined) throw new Error("expected a rotate event");
    expect(last.detail).toMatchObject({ free: true, draft: true });
    dispose();
  });

  it("emits edgeDrag with the grab point and cumulative delta", () => {
    const { scene, dispose } = makeScene();
    const edge = new TransformNode("om-edge:0", scene);
    edge.metadata = { kind: "edge", nodeId: "0" };
    const { mode, events } = setup();

    mode.begin(start(edge, { x: 100, y: 50 }));
    mode.update({ x: 130, y: 60 }, move(130, 60));
    mode.commit({ x: 130, y: 60 }, move(130, 60));

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
    dispose();
  });

  it("does not start on an edge with a non-numeric index", () => {
    const { scene, dispose } = makeScene();
    const edge = new TransformNode("om-edge:x", scene);
    edge.metadata = { kind: "edge", nodeId: "x" };
    const { mode } = setup();

    expect(mode.begin(start(edge, { x: 0, y: 0 }))).toBe(false);
    dispose();
  });
});
