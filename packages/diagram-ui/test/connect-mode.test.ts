import { beforeEach, describe, expect, it, vi } from "vitest";
import { Container } from "pixi.js";

vi.mock("../src/base/overlay-mesh.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/base/overlay-mesh.js")>()),
  buildWireMesh: vi.fn(() => null),
  buildRectMesh: vi.fn(() => null),
  disposeOverlayMesh: vi.fn(),
}));

import { ConnectMode } from "../src/interaction/connect-mode.js";
import type {
  CompatCheck,
  ConnectorPosition,
  DragEvents,
  GestureStart,
} from "../src/interaction/gesture-mode.js";
import { entityKeyForNode, tagEntity } from "../src/interaction/node-keys.js";
import {
  buildWireMesh,
  disposeOverlayMesh,
  CONNECT_BAD_COLOR,
  CONNECT_OK_COLOR,
} from "../src/base/overlay-mesh.js";

function portMesh(connectorId: string): Container {
  const conn = new Container();
  tagEntity(conn, "connector", connectorId);
  const port = new Container();
  tagEntity(port, "port", connectorId);
  conn.addChild(port);
  return port;
}

function connectorMesh(connectorId: string): Container {
  const conn = new Container();
  tagEntity(conn, "connector", connectorId);
  return conn;
}

function start(node: Container, point: { x: number; y: number }): GestureStart {
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

function lastOf<T>(arr: readonly T[]): T {
  const v = arr.at(-1);
  if (v === undefined) {
    throw new Error("expected a non-empty array");
  }
  return v;
}

function makeMode(opts: {
  picker: () => Container | null;
  events: DragEvents["connection"][];
  connectorPosition?: ConnectorPosition;
  evaluateCompat?: CompatCheck;
}): ConnectMode {
  return new ConnectMode(
    opts.picker,
    (type, detail) => {
      if (type === "connection") {
        opts.events.push(detail as DragEvents["connection"]);
      }
    },
    new Container(),
    opts.connectorPosition ?? (() => null),
    opts.evaluateCompat ?? (() => null),
  );
}

describe("ConnectMode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits connection events from a port through to commit", () => {
    const source = portMesh("p");
    const events: DragEvents["connection"][] = [];
    const mode = makeMode({ picker: () => source, events });

    mode.begin(start(source, { x: 0, y: 0 }));
    mode.update({ x: 50, y: 30 }, at(50, 30));
    mode.commit({ x: 50, y: 30 }, at(50, 30));

    expect(events).toHaveLength(3);
    const last = lastOf(events);
    expect(last.from).toBe("k:p");
    expect(last.commit).toBe(true);
    expect(last.to).toEqual({ x: 50, y: 30 });
  });

  it("populates toKey when the drag ends over another connector", () => {
    const source = portMesh("out");
    const target = connectorMesh("in");
    const events: DragEvents["connection"][] = [];
    let picked: Container = source;
    const mode = makeMode({ picker: () => picked, events });

    mode.begin(start(source, { x: 0, y: 0 }));
    picked = target;
    mode.commit({ x: 80, y: 0 }, at(80, 0));

    const last = lastOf(events);
    expect(last.commit).toBe(true);
    expect(last.toKey).toBe("k:in");
  });

  it("snaps toKey to a target then clears it when the cursor leaves", () => {
    const source = portMesh("out");
    const target = connectorMesh("in");
    const events: DragEvents["connection"][] = [];
    let picked: Container | null = source;
    const mode = makeMode({ picker: () => picked, events });

    mode.begin(start(source, { x: 0, y: 0 }));
    picked = target;
    mode.update({ x: 80, y: 0 }, at(80, 0));
    const overTarget = lastOf(events);
    picked = null;
    mode.update({ x: 200, y: 0 }, at(200, 0));
    const overEmpty = lastOf(events);

    expect(overTarget.toKey).toBe("k:in");
    expect(overEmpty.toKey).toBeNull();
  });

  it("never snaps toKey back onto the source connector", () => {
    const source = portMesh("self");
    const sourceConn = connectorMesh("self");
    const events: DragEvents["connection"][] = [];
    let picked: Container = source;
    const mode = makeMode({ picker: () => picked, events });

    mode.begin(start(source, { x: 0, y: 0 }));
    picked = sourceConn;
    mode.commit({ x: 5, y: 0 }, at(5, 0));

    expect(lastOf(events).toKey).toBeNull();
  });

  it("tracks the live cursor position on each update", () => {
    const source = portMesh("p");
    const events: DragEvents["connection"][] = [];
    const mode = makeMode({ picker: () => source, events });

    mode.begin(start(source, { x: 0, y: 0 }));
    mode.update({ x: 30, y: 10 }, at(30, 10));
    mode.update({ x: 60, y: 40 }, at(60, 40));
    mode.commit({ x: 60, y: 40 }, at(60, 40));

    const tos = events.map((e) => e.to);
    expect(tos).toContainEqual({ x: 30, y: 10 });
    expect(tos).toContainEqual({ x: 60, y: 40 });
  });

  it("does not start when the press is not on a port or connector", () => {
    const comp = new Container();
    tagEntity(comp, "component", "R1");
    const mode = makeMode({ picker: () => comp, events: [] });
    expect(mode.begin(start(comp, { x: 0, y: 0 }))).toBe(false);
  });

  it("draws the wire from the connector position and clears it on commit", () => {
    const source = portMesh("p");
    const mode = makeMode({
      picker: () => source,
      events: [],
      connectorPosition: () => ({ x: 7, y: 9 }),
    });

    mode.begin(start(source, { x: 0, y: 0 }));
    expect(buildWireMesh).toHaveBeenCalledTimes(1);
    const call = lastOf(vi.mocked(buildWireMesh).mock.calls);
    // (parent, from, to, color)
    expect(call[1]).toEqual({ x: 7, y: 9 });
    expect(call[3]).toBe(CONNECT_OK_COLOR);

    const disposesBefore = vi.mocked(disposeOverlayMesh).mock.calls.length;
    mode.commit({ x: 50, y: 30 }, at(50, 30));
    // Commit clears the wire and does not draw a new one.
    expect(buildWireMesh).toHaveBeenCalledTimes(1);
    expect(vi.mocked(disposeOverlayMesh).mock.calls.length).toBe(
      disposesBefore + 1,
    );
  });

  it("colours the wire red over an incompatible target", () => {
    const source = portMesh("out");
    const target = connectorMesh("in");
    let picked: Container = source;
    const mode = makeMode({
      picker: () => picked,
      events: [],
      evaluateCompat: (_from, toKey) =>
        toKey ? { ok: false, reason: "incompatible" } : null,
    });

    mode.begin(start(source, { x: 0, y: 0 }));
    picked = target;
    mode.update({ x: 80, y: 0 }, at(80, 0));

    const lastCall = lastOf(vi.mocked(buildWireMesh).mock.calls);
    expect(lastCall[3]).toBe(CONNECT_BAD_COLOR);
  });

  it("carries fromPoint and compat on the connection event for the host", () => {
    const source = portMesh("out");
    const target = connectorMesh("in");
    let picked: Container = source;
    const events: DragEvents["connection"][] = [];
    const mode = makeMode({
      picker: () => picked,
      events,
      connectorPosition: () => ({ x: 7, y: 9 }),
      evaluateCompat: (_from, toKey) =>
        toKey ? { ok: false, reason: "incompatible" } : null,
    });

    mode.begin(start(source, { x: 0, y: 0 }));
    picked = target;
    mode.update({ x: 80, y: 0 }, at(80, 0));

    const last = lastOf(events);
    expect(last.fromPoint).toEqual({ x: 7, y: 9 });
    expect(last.compat).toEqual({ ok: false, reason: "incompatible" });
  });

  it("clears the wire on cancel without committing", () => {
    const source = portMesh("p");
    const events: DragEvents["connection"][] = [];
    const mode = makeMode({
      picker: () => source,
      events,
      connectorPosition: () => ({ x: 7, y: 9 }),
    });

    mode.begin(start(source, { x: 0, y: 0 }));
    const disposesBefore = vi.mocked(disposeOverlayMesh).mock.calls.length;
    mode.cancel();

    expect(vi.mocked(disposeOverlayMesh).mock.calls.length).toBe(
      disposesBefore + 1,
    );
    // Cancel never fires a commit.
    expect(events.some((e) => e.commit)).toBe(false);
  });
});
