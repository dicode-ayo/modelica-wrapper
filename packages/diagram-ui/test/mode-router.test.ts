import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";

import { ModeRouter } from "../src/interaction/mode.js";
import type { DragEvents } from "../src/interaction/gesture-mode.js";
import type { InteractionEvents } from "../src/interaction/interaction-manager.js";
import { InteractionStateStore } from "../src/interaction/interaction-state.js";
import { tagEntity } from "../src/interaction/node-keys.js";

/** `DragEmit` is generic, so `type` can't narrow `detail` on its own. */
function isMove(
  type: keyof DragEvents,
  _detail: DragEvents[keyof DragEvents],
): _detail is DragEvents["drag"] {
  return type === "drag";
}
import type { ToolDraw } from "../src/interaction/tool-mode.js";
import type { ToolId } from "../src/interaction/tools.js";

function portMesh(connectorId: string): Container {
  const conn = new Container();
  tagEntity(conn, "connector", connectorId);
  const port = new Container();
  tagEntity(port, "port", connectorId);
  conn.addChild(port);
  return port;
}

function componentNode(id: string): Container {
  const c = new Container();
  tagEntity(c, "component", id);
  return c;
}

function standaloneConnectorNode(portName: string): Container {
  const conn = new Container();
  tagEntity(conn, "connector", portName);
  return conn;
}

/** A connector body parented inside a component, as a nested port is. */
function nestedConnectorNode(componentId: string, portName: string): Container {
  const comp = new Container();
  tagEntity(comp, "component", componentId);
  const conn = new Container();
  tagEntity(conn, "connector", portName);
  comp.addChild(conn);
  return conn;
}

interface Harness {
  canvas: HTMLCanvasElement;
  router: ModeRouter;
  store: InteractionStateStore;
  calls: string[];
  moves: DragEvents["drag"][];
  interactions: {
    type: keyof InteractionEvents;
    detail: InteractionEvents[keyof InteractionEvents];
  }[];
  tool: ToolDraw[];
  setPicked: (n: Container | null) => void;
  dispose: () => void;
}

function setup(
  activeTool: ToolId = "select",
  selection: string[] = [],
): Harness {
  let picked: Container | null = null;
  const calls: string[] = [];
  const moves: DragEvents["drag"][] = [];
  const interactions: Harness["interactions"] = [];
  const tool: ToolDraw[] = [];
  const store = new InteractionStateStore();
  const canvas = document.createElement("canvas");
  const router = new ModeRouter({
    canvas,
    picker: () => picked,
    clientToDiagram: (cx, cy) => ({ x: cx, y: cy }),
    getSelectionKeys: () => selection,
    onInteraction: (type, detail) => {
      calls.push("interaction");
      interactions.push({ type, detail });
    },
    onDrag: (type, detail) => {
      calls.push("drag");
      if (isMove(type, detail)) {
        moves.push(detail);
      }
    },
    store,
    overlayParent: new Container(),
    connectorPosition: () => null,
    evaluateCompat: () => null,
    getActiveTool: () => activeTool,
    getSnapGrid: () => [0, 0],
    onTool: (draw) => tool.push(draw),
  });
  return {
    canvas,
    router,
    store,
    calls,
    moves,
    interactions,
    tool,
    setPicked: (n) => (picked = n),
    dispose: () => {
      router.destroy();
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
    const { canvas, store, setPicked, dispose } = setup();
    setPicked(componentNode("R1"));
    canvas.dispatchEvent(down());
    expect(store.value.mode).toBe("drag");
    dispose();
  });

  it("routes a vertex-handle press to a drag, never a select", () => {
    // A vertex dot is a drag handle, not a selectable entity: pressing it
    // must start a vertex drag, not replace the shape's selection (which
    // would hide the dots out from under the gesture).
    const { canvas, store, calls, setPicked, dispose } = setup();
    const wrapper = new Container();
    tagEntity(wrapper, "shape", "line:0");
    const dot = new Container();
    tagEntity(dot, "vertex-handle", "line:0/1");
    wrapper.addChild(dot);
    setPicked(dot);
    canvas.dispatchEvent(down());
    expect(store.value.mode).toBe("drag");
    expect(calls).toContain("drag");
    dispose();
  });

  it("transitions to connect on a port press", () => {
    const { canvas, store, setPicked, dispose } = setup();
    setPicked(portMesh("p"));
    canvas.dispatchEvent(down());
    expect(store.value.mode).toBe("connect");
    dispose();
  });

  it("moves a standalone connector on a body press, carrying its key", () => {
    const { canvas, store, moves, setPicked, dispose } = setup();
    setPicked(standaloneConnectorNode("p"));
    canvas.dispatchEvent(down());
    expect(store.value.mode).toBe("drag");
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 25, clientY: 25 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, clientX: 25, clientY: 25 }),
    );
    expect(moves.at(-1)).toEqual({
      keys: ["k:p"],
      dx: 20,
      dy: 20,
      draft: false,
    });
    dispose();
  });

  it("still starts a connection on a nested connector body press", () => {
    const { canvas, store, setPicked, dispose } = setup();
    setPicked(nestedConnectorNode("R1", "p"));
    canvas.dispatchEvent(down());
    expect(store.value.mode).toBe("connect");
    dispose();
  });

  it("runs the InteractionManager always, before the gesture (hover-before-drag order)", () => {
    const { canvas, calls, setPicked, dispose } = setup();
    // A port press makes the InteractionManager emit `select` and
    // ConnectMode emit `connection`; the interaction one must come first.
    setPicked(portMesh("p"));
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
    const { canvas, calls, setPicked, dispose } = setup();
    setPicked(componentNode("R1"));
    canvas.dispatchEvent(down({ pointerId: 1 }));
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: 2, clientX: 9, clientY: 9 }),
    );
    expect(calls.filter((c) => c === "drag")).toHaveLength(0);
    dispose();
  });

  it("routes a primary press to the poly tool, placing a vertex under store mode draw", () => {
    const { canvas, store, router, tool, dispose } = setup("line");
    canvas.dispatchEvent(down());
    // A multi-click draw is now in flight (no press-drag gesture / capture).
    expect(router.isGestureActive()).toBe(true);
    expect(store.value.mode).toBe("draw");
    expect(tool).toEqual([
      {
        phase: "draft",
        shape: { kind: "line", points: [[5, 5]], color: [0, 0, 0] },
      },
    ]);
    dispose();
  });

  it("ignores shift+primary while a poly tool is armed (pan modifier)", () => {
    const { canvas, tool, dispose } = setup("polygon");
    canvas.dispatchEvent(down({ shiftKey: true }));
    expect(tool).toHaveLength(0);
    dispose();
  });

  it("rubber-bands cursor moves once a vertex is placed, without touching hover", () => {
    const { canvas, calls, tool, dispose } = setup("line");
    // A move before the first vertex is a no-op; after a press it drafts.
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 8, clientY: 9 }),
    );
    expect(tool).toHaveLength(0);
    canvas.dispatchEvent(down());
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 8, clientY: 9 }),
    );
    expect(tool.at(-1)).toEqual({
      phase: "draft",
      shape: {
        kind: "line",
        points: [
          [5, 5],
          [8, 9],
        ],
        color: [0, 0, 0],
      },
    });
    expect(calls).toHaveLength(0);
    dispose();
  });

  it("abandons an in-flight extent draw on pointercancel instead of committing", () => {
    const { canvas, store, router, tool, dispose } = setup("rectangle");
    canvas.dispatchEvent(down());
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 30, clientY: 30 }),
    );
    // A draft is in flight (no committed shape yet).
    expect(tool.at(-1)?.phase).toBe("draft");
    canvas.dispatchEvent(
      new PointerEvent("pointercancel", {
        pointerId: 0,
        clientX: 30,
        clientY: 30,
      }),
    );
    // The cancel drops the preview — never a real commit.
    expect(tool.some((d) => d.phase === "commit")).toBe(false);
    expect(tool.at(-1)).toEqual({ phase: "cancel" });
    expect(router.isGestureActive()).toBe(false);
    expect(store.value.mode).toBe("idle");
    dispose();
  });

  it("carries the whole selection when a member is press-dragged", () => {
    const { canvas, moves, interactions, setPicked, dispose } = setup(
      "select",
      ["c:R1", "c:R2"],
    );
    setPicked(componentNode("R1"));
    canvas.dispatchEvent(down());
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 25, clientY: 25 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, clientX: 25, clientY: 25 }),
    );

    expect(moves.at(-1)).toEqual({
      keys: ["c:R1", "c:R2"],
      dx: 20,
      dy: 20,
      draft: false,
    });
    // No selection change reached the host at any point in the gesture.
    expect(interactions.filter((i) => i.type === "select")).toHaveLength(0);
    dispose();
  });

  it("narrows to the pressed member when the press does not become a drag", () => {
    const { canvas, interactions, setPicked, dispose } = setup("select", [
      "c:R1",
      "c:R2",
    ]);
    setPicked(componentNode("R1"));
    canvas.dispatchEvent(down());
    canvas.dispatchEvent(up());

    expect(interactions.filter((i) => i.type === "select")).toEqual([
      {
        type: "select",
        detail: { key: "c:R1", addToSelection: false },
      },
    ]);
    dispose();
  });

  it("clears the gesture on pointercancel", () => {
    const { canvas, router, store, setPicked, dispose } = setup();
    setPicked(componentNode("R1"));
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
