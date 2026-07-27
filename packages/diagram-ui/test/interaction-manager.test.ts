import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";

import {
  InteractionManager,
  type InteractionEvents,
} from "../src/interaction/interaction-manager.js";
import { tagEntity } from "../src/interaction/node-keys.js";

/** Drive the listener-free InteractionManager from dispatched events. */
function wireInteraction(
  canvas: HTMLCanvasElement,
  m: InteractionManager,
): void {
  canvas.addEventListener("pointermove", (e) => m.handlePointerMove(e));
  canvas.addEventListener("pointerdown", (e) => m.handlePointerDown(e));
  canvas.addEventListener("pointerup", (e) => m.handlePointerUp(e));
  canvas.addEventListener("pointercancel", (e) => m.handlePointerCancel(e));
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

/** A tagged entity container the picker stub returns. */
function node(
  kind: Parameters<typeof tagEntity>[1],
  nodeId: string,
): Container {
  const c = new Container();
  tagEntity(c, kind, nodeId);
  return c;
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
    const tn = node("component", "foo");
    const { emit, events } = captureEmits();
    const picker = (_x: number, _y: number): Container | null => tn;
    const mgr = new InteractionManager(picker, emit);
    wireInteraction(canvas, mgr);

    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 10, clientY: 10 }),
    );
    expect(events).toEqual([{ type: "hover", detail: { key: "c:foo" } }]);
    canvas.remove();
  });

  it("does not re-emit hover when the key doesn't change", () => {
    const canvas = makeCanvas();
    const tn = node("component", "foo");
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
    canvas.remove();
  });

  it("emits select on primary-button pointerdown", () => {
    const canvas = makeCanvas();
    const tn = node("connector", "p");
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
    canvas.remove();
  });

  it("does NOT emit select when a resize/rotate handle is picked", () => {
    const canvas = makeCanvas();
    const { emit, events } = captureEmits();
    for (const kind of ["handle", "rotate-handle"] as const) {
      const handle = node(kind, "tl");
      const mgr = new InteractionManager(() => handle, emit);
      wireInteraction(canvas, mgr);
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { button: 0, clientX: 5, clientY: 5 }),
      );
    }
    expect(events).toHaveLength(0);
    canvas.remove();
  });

  it("shift+primary down DOES NOT emit select (pan modifier)", () => {
    const canvas = makeCanvas();
    const tn = node("component", "R1");
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
    canvas.remove();
  });

  it("ctrl/cmd+primary down emits select with addToSelection", () => {
    // Shift is taken by pan, so additive selection rides Ctrl/Cmd instead.
    for (const modifier of ["ctrlKey", "metaKey"] as const) {
      const canvas = makeCanvas();
      const tn = node("component", "R1");
      const { emit, events } = captureEmits();
      const mgr = new InteractionManager(() => tn, emit);
      wireInteraction(canvas, mgr);

      canvas.dispatchEvent(
        new PointerEvent("pointerdown", {
          button: 0,
          [modifier]: true,
          clientX: 5,
          clientY: 5,
        }),
      );
      expect(events).toEqual([
        { type: "select", detail: { key: "c:R1", addToSelection: true } },
      ]);
      canvas.remove();
    }
  });

  it("an unmodified primary down replaces rather than adds", () => {
    const canvas = makeCanvas();
    const tn = node("component", "R1");
    const { emit, events } = captureEmits();
    const mgr = new InteractionManager(() => tn, emit);
    wireInteraction(canvas, mgr);

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 5, clientY: 5 }),
    );
    expect(events).toEqual([
      { type: "select", detail: { key: "c:R1", addToSelection: false } },
    ]);
    canvas.remove();
  });

  it("emits doubleClick on a second select within the window", () => {
    const canvas = makeCanvas();
    const tn = node("component", "R1");
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
    canvas.remove();
  });

  it("emits contextMenu on secondary-button pointerup", () => {
    const canvas = makeCanvas();
    const tn = node("component", "R1");
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
    canvas.remove();
  });

  describe("pressing a member of a multi-selection", () => {
    const selection = ["c:R1", "c:R2"];

    it("defers the select to the release so a drag can carry the group", () => {
      const canvas = makeCanvas();
      const tn = node("component", "R1");
      const { emit, events } = captureEmits();
      const mgr = new InteractionManager(() => tn, emit, {
        getSelectionKeys: () => selection,
      });
      wireInteraction(canvas, mgr);

      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { button: 0, clientX: 5, clientY: 5 }),
      );
      // Nothing emitted yet: DragMode.begin reads the selection during this
      // same press and must still see both keys.
      expect(events).toHaveLength(0);

      canvas.dispatchEvent(
        new PointerEvent("pointerup", { button: 0, clientX: 5, clientY: 5 }),
      );
      expect(events).toEqual([
        { type: "select", detail: { key: "c:R1", addToSelection: false } },
      ]);
      canvas.remove();
    });

    it("drops the deferred select once the pointer travels past the slop", () => {
      const canvas = makeCanvas();
      const tn = node("component", "R1");
      const { emit, events } = captureEmits();
      const mgr = new InteractionManager(() => tn, emit, {
        getSelectionKeys: () => selection,
      });
      wireInteraction(canvas, mgr);

      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { button: 0, clientX: 5, clientY: 5 }),
      );
      canvas.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 60, clientY: 60 }),
      );
      canvas.dispatchEvent(
        new PointerEvent("pointerup", { button: 0, clientX: 60, clientY: 60 }),
      );
      expect(events.filter((e) => e.type === "select")).toHaveLength(0);
      canvas.remove();
    });

    it("keeps the deferred select through jitter under the slop", () => {
      const canvas = makeCanvas();
      const tn = node("component", "R1");
      const { emit, events } = captureEmits();
      const mgr = new InteractionManager(() => tn, emit, {
        getSelectionKeys: () => selection,
      });
      wireInteraction(canvas, mgr);

      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { button: 0, clientX: 5, clientY: 5 }),
      );
      canvas.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 6, clientY: 6 }),
      );
      canvas.dispatchEvent(
        new PointerEvent("pointerup", { button: 0, clientX: 6, clientY: 6 }),
      );
      expect(events.filter((e) => e.type === "select")).toEqual([
        { type: "select", detail: { key: "c:R1", addToSelection: false } },
      ]);
      canvas.remove();
    });

    it("drops the deferred select on pointercancel rather than narrowing", () => {
      const canvas = makeCanvas();
      const tn = node("component", "R1");
      const { emit, events } = captureEmits();
      const mgr = new InteractionManager(() => tn, emit, {
        getSelectionKeys: () => selection,
      });
      wireInteraction(canvas, mgr);

      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { button: 0, clientX: 5, clientY: 5 }),
      );
      canvas.dispatchEvent(
        new PointerEvent("pointercancel", { clientX: 5, clientY: 5 }),
      );
      canvas.dispatchEvent(
        new PointerEvent("pointerup", { button: 0, clientX: 5, clientY: 5 }),
      );
      expect(events).toHaveLength(0);
      canvas.remove();
    });

    it("still toggles immediately under ctrl/cmd", () => {
      const canvas = makeCanvas();
      const tn = node("component", "R1");
      const { emit, events } = captureEmits();
      const mgr = new InteractionManager(() => tn, emit, {
        getSelectionKeys: () => selection,
      });
      wireInteraction(canvas, mgr);

      canvas.dispatchEvent(
        new PointerEvent("pointerdown", {
          button: 0,
          ctrlKey: true,
          clientX: 5,
          clientY: 5,
        }),
      );
      expect(events).toEqual([
        { type: "select", detail: { key: "c:R1", addToSelection: true } },
      ]);
      canvas.remove();
    });

    it("still emits doubleClick on the press, not the release", () => {
      const canvas = makeCanvas();
      const tn = node("component", "R1");
      const { emit, events } = captureEmits();
      const mgr = new InteractionManager(() => tn, emit, {
        doubleClickMs: 1000,
        getSelectionKeys: () => selection,
      });
      wireInteraction(canvas, mgr);

      const press = (): void => {
        canvas.dispatchEvent(
          new PointerEvent("pointerdown", {
            button: 0,
            clientX: 0,
            clientY: 0,
          }),
        );
      };
      press();
      press();
      expect(events.map((e) => e.type)).toEqual(["select", "doubleClick"]);
      canvas.remove();
    });
  });

  it("selects immediately when the pressed entity is outside the selection", () => {
    const canvas = makeCanvas();
    const tn = node("component", "R3");
    const { emit, events } = captureEmits();
    const mgr = new InteractionManager(() => tn, emit, {
      getSelectionKeys: () => ["c:R1", "c:R2"],
    });
    wireInteraction(canvas, mgr);

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 5, clientY: 5 }),
    );
    expect(events).toEqual([
      { type: "select", detail: { key: "c:R3", addToSelection: false } },
    ]);
    canvas.remove();
  });

  it("selects immediately when the pressed entity is the lone selection", () => {
    const canvas = makeCanvas();
    const tn = node("component", "R1");
    const { emit, events } = captureEmits();
    const mgr = new InteractionManager(() => tn, emit, {
      getSelectionKeys: () => ["c:R1"],
    });
    wireInteraction(canvas, mgr);

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 5, clientY: 5 }),
    );
    expect(events).toEqual([
      { type: "select", detail: { key: "c:R1", addToSelection: false } },
    ]);
    canvas.remove();
  });

  it("hovering a vertex dot reports the owner shape, but pressing it still selects nothing", () => {
    const canvas = makeCanvas();
    const shape = node("shape", "line:1");
    const dot = new Container();
    tagEntity(dot, "vertex-handle", "0");
    shape.addChild(dot);
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
    canvas.remove();
  });
});
