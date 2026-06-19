import { describe, expect, it } from "vitest";
import { NullEngine, Node, Scene, TransformNode } from "@babylonjs/core";

import { ConnectMode } from "../src/interaction/connect-mode.js";
import type {
  CompatCheck,
  ConnectorPosition,
  DragEvents,
  GestureStart,
} from "../src/interaction/gesture-mode.js";
import { entityKeyForNode } from "../src/interaction/node-keys.js";
import {
  CONNECT_BAD_COLOR,
  CONNECT_OK_COLOR,
} from "../src/base/gesture-overlay.js";
import { fakeOverlay, type RecordingOverlay } from "./harness/fake-overlay.js";

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

function connectorMesh(scene: Scene, connectorId: string): TransformNode {
  return new TransformNode(`om-connector:${connectorId}`, scene);
}

function start(node: Node, point: { x: number; y: number }): GestureStart {
  return {
    node,
    entity: entityKeyForNode(node),
    point,
    shiftKey: false,
    getSelectionKeys: () => [],
  };
}

const at = (x: number, y: number) =>
  new PointerEvent("pointermove", { clientX: x, clientY: y });

function makeMode(opts: {
  picker: () => Node | null;
  events: DragEvents["connection"][];
  connectorPosition?: ConnectorPosition;
  evaluateCompat?: CompatCheck;
}): { mode: ConnectMode; overlay: RecordingOverlay } {
  const overlay = fakeOverlay();
  const mode = new ConnectMode(
    opts.picker,
    (type, detail) => {
      if (type === "connection") {
        opts.events.push(detail as DragEvents["connection"]);
      }
    },
    overlay,
    opts.connectorPosition ?? (() => null),
    opts.evaluateCompat ?? (() => null),
  );
  return { mode, overlay };
}

describe("ConnectMode", () => {
  it("emits connection events from a port through to commit", () => {
    const { scene, dispose } = makeScene();
    const source = portMesh(scene, "p");
    const events: DragEvents["connection"][] = [];
    const { mode } = makeMode({ picker: () => source, events });

    mode.begin(start(source, { x: 0, y: 0 }));
    mode.update({ x: 50, y: 30 }, at(50, 30));
    mode.commit({ x: 50, y: 30 }, at(50, 30));

    expect(events).toHaveLength(3);
    const last = events.at(-1)!;
    expect(last.from).toBe("k:p");
    expect(last.commit).toBe(true);
    expect(last.to).toEqual({ x: 50, y: 30 });
    dispose();
  });

  it("populates toKey when the drag ends over another connector", () => {
    const { scene, dispose } = makeScene();
    const source = portMesh(scene, "out");
    const target = connectorMesh(scene, "in");
    const events: DragEvents["connection"][] = [];
    let picked: Node = source;
    const { mode } = makeMode({ picker: () => picked, events });

    mode.begin(start(source, { x: 0, y: 0 }));
    picked = target;
    mode.commit({ x: 80, y: 0 }, at(80, 0));

    const last = events.at(-1)!;
    expect(last.commit).toBe(true);
    expect(last.toKey).toBe("k:in");
    dispose();
  });

  it("snaps toKey to a target then clears it when the cursor leaves", () => {
    const { scene, dispose } = makeScene();
    const source = portMesh(scene, "out");
    const target = connectorMesh(scene, "in");
    const events: DragEvents["connection"][] = [];
    let picked: Node | null = source;
    const { mode } = makeMode({ picker: () => picked, events });

    mode.begin(start(source, { x: 0, y: 0 }));
    picked = target;
    mode.update({ x: 80, y: 0 }, at(80, 0));
    const overTarget = events.at(-1)!;
    picked = null;
    mode.update({ x: 200, y: 0 }, at(200, 0));
    const overEmpty = events.at(-1)!;

    expect(overTarget.toKey).toBe("k:in");
    expect(overEmpty.toKey).toBeNull();
    dispose();
  });

  it("never snaps toKey back onto the source connector", () => {
    const { scene, dispose } = makeScene();
    const source = portMesh(scene, "self");
    const sourceConn = connectorMesh(scene, "self");
    const events: DragEvents["connection"][] = [];
    let picked: Node = source;
    const { mode } = makeMode({ picker: () => picked, events });

    mode.begin(start(source, { x: 0, y: 0 }));
    picked = sourceConn;
    mode.commit({ x: 5, y: 0 }, at(5, 0));

    expect(events.at(-1)!.toKey).toBeNull();
    dispose();
  });

  it("tracks the live cursor position on each update", () => {
    const { scene, dispose } = makeScene();
    const source = portMesh(scene, "p");
    const events: DragEvents["connection"][] = [];
    const { mode } = makeMode({ picker: () => source, events });

    mode.begin(start(source, { x: 0, y: 0 }));
    mode.update({ x: 30, y: 10 }, at(30, 10));
    mode.update({ x: 60, y: 40 }, at(60, 40));
    mode.commit({ x: 60, y: 40 }, at(60, 40));

    const tos = events.map((e) => e.to);
    expect(tos).toContainEqual({ x: 30, y: 10 });
    expect(tos).toContainEqual({ x: 60, y: 40 });
    dispose();
  });

  it("does not start when the press is not on a port or connector", () => {
    const { scene, dispose } = makeScene();
    const comp = new TransformNode("om-component:R1", scene);
    const { mode } = makeMode({ picker: () => comp, events: [] });
    expect(mode.begin(start(comp, { x: 0, y: 0 }))).toBe(false);
    dispose();
  });

  it("draws the wire from the connector position and clears it on commit", () => {
    const { scene, dispose } = makeScene();
    const source = portMesh(scene, "p");
    const { mode, overlay } = makeMode({
      picker: () => source,
      events: [],
      connectorPosition: () => ({ x: 7, y: 9 }),
    });

    mode.begin(start(source, { x: 0, y: 0 }));
    expect(overlay.wires).toHaveLength(1);
    expect(overlay.wires[0]!.from).toEqual({ x: 7, y: 9 });
    expect(overlay.wires[0]!.color).toBe(CONNECT_OK_COLOR);

    mode.commit({ x: 50, y: 30 }, at(50, 30));
    expect(overlay.wireHidden).toBe(1);
    dispose();
  });

  it("colours the wire red over an incompatible target", () => {
    const { scene, dispose } = makeScene();
    const source = portMesh(scene, "out");
    const target = connectorMesh(scene, "in");
    let picked: Node = source;
    const { mode, overlay } = makeMode({
      picker: () => picked,
      events: [],
      evaluateCompat: (_from, toKey) =>
        toKey ? { ok: false, reason: "incompatible" } : null,
    });

    mode.begin(start(source, { x: 0, y: 0 }));
    picked = target;
    mode.update({ x: 80, y: 0 }, at(80, 0));

    expect(overlay.wires.at(-1)!.color).toBe(CONNECT_BAD_COLOR);
    dispose();
  });
});
