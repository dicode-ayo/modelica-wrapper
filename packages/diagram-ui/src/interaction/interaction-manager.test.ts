/**
 * `InteractionManager` translates pointer events into select/hover/
 * doubleClick/contextMenu. A double click requires two actual clicks: a
 * press that travels past the drag slop before release is a drag, not a
 * click, and must not pair with a later click to fake one.
 */

import { Container } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SelectionProvider } from "./gesture-mode.js";
import {
  InteractionManager,
  type EmitFn,
  type InteractionEvents,
  type PickerFn,
} from "./interaction-manager.js";
import { tagEntity } from "./node-keys.js";

const DOUBLE_CLICK_MS = 350;

function componentNode(id: string): Container {
  const node = new Container();
  tagEntity(node, "component", id);
  return node;
}

function pointerEvent(
  type: string,
  init: {
    button?: number;
    pointerId?: number;
    clientX?: number;
    clientY?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  } = {},
): PointerEvent {
  const event = new Event(type, { bubbles: true }) as PointerEvent;
  Object.defineProperty(event, "button", { value: init.button ?? 0 });
  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  Object.defineProperty(event, "clientX", { value: init.clientX ?? 0 });
  Object.defineProperty(event, "clientY", { value: init.clientY ?? 0 });
  Object.defineProperty(event, "ctrlKey", { value: init.ctrlKey ?? false });
  Object.defineProperty(event, "metaKey", { value: init.metaKey ?? false });
  Object.defineProperty(event, "shiftKey", { value: init.shiftKey ?? false });
  return event;
}

type Recorded = {
  [K in keyof InteractionEvents]: { type: K; detail: InteractionEvents[K] };
}[keyof InteractionEvents];

function makeManager(opts: {
  target: Container | null;
  selection?: string[];
}): {
  manager: InteractionManager;
  events: Recorded[];
  setTarget: (target: Container | null) => void;
} {
  const events: Recorded[] = [];
  // EmitFn's generic K correlates type/detail at the call site, but TS can't
  // carry that through into a destructured object literal — the pairing is
  // still guaranteed by the signature, just not provable here.
  const emit: EmitFn = (type, detail) => {
    events.push({ type, detail } as Recorded);
  };
  let target = opts.target;
  const picker: PickerFn = () => target;
  const getSelectionKeys: SelectionProvider = () => opts.selection ?? [];
  const manager = new InteractionManager(picker, emit, getSelectionKeys, {
    doubleClickMs: DOUBLE_CLICK_MS,
  });
  return {
    manager,
    events,
    setTarget: (next) => {
      target = next;
    },
  };
}

function selectEvents(events: Recorded[]): InteractionEvents["select"][] {
  return events
    .filter(
      (e): e is Extract<Recorded, { type: "select" }> => e.type === "select",
    )
    .map((e) => e.detail);
}

function doubleClickCount(events: Recorded[]): number {
  return events.filter((e) => e.type === "doubleClick").length;
}

describe("InteractionManager", () => {
  let now = 0;
  beforeEach(() => {
    now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits select on a plain primary press", () => {
    const a = componentNode("A");
    const { manager, events } = makeManager({ target: a });

    manager.handlePointerDown(pointerEvent("pointerdown"));

    expect(selectEvents(events)).toEqual([
      { key: "c:A", addToSelection: false },
    ]);
  });

  it("marks addToSelection on a ctrl/cmd press", () => {
    const a = componentNode("A");
    const { manager, events } = makeManager({ target: a });

    manager.handlePointerDown(pointerEvent("pointerdown", { ctrlKey: true }));

    expect(selectEvents(events)).toEqual([
      { key: "c:A", addToSelection: true },
    ]);
  });

  it("emits doubleClick on two stationary presses on the same key within the window", () => {
    const a = componentNode("A");
    const { manager, events } = makeManager({ target: a });

    manager.handlePointerDown(pointerEvent("pointerdown"));
    manager.handlePointerUp(pointerEvent("pointerup"));
    now += 100;
    manager.handlePointerDown(pointerEvent("pointerdown"));

    expect(doubleClickCount(events)).toBe(1);
  });

  it("does not emit doubleClick once the window has elapsed", () => {
    const a = componentNode("A");
    const { manager, events } = makeManager({ target: a });

    manager.handlePointerDown(pointerEvent("pointerdown"));
    manager.handlePointerUp(pointerEvent("pointerup"));
    now += DOUBLE_CLICK_MS + 1;
    manager.handlePointerDown(pointerEvent("pointerdown"));

    expect(doubleClickCount(events)).toBe(0);
  });

  describe("press-drag then click", () => {
    it("does not arm a spurious double click after a press that drags away and back", () => {
      const a = componentNode("A");
      const { manager, events } = makeManager({ target: a });

      // Press, drag well past the slop and back to the start, release — a
      // move-drag, not a click, regardless of where it ends up.
      manager.handlePointerDown(
        pointerEvent("pointerdown", { clientX: 0, clientY: 0 }),
      );
      manager.handlePointerMove(
        pointerEvent("pointermove", { clientX: 50, clientY: 50 }),
      );
      manager.handlePointerMove(
        pointerEvent("pointermove", { clientX: 0, clientY: 0 }),
      );
      manager.handlePointerUp(
        pointerEvent("pointerup", { clientX: 0, clientY: 0 }),
      );

      // A stationary click on the same entity, within the window.
      now += 50;
      manager.handlePointerDown(pointerEvent("pointerdown"));
      manager.handlePointerUp(pointerEvent("pointerup"));

      expect(doubleClickCount(events)).toBe(0);
      // The click itself still selects.
      expect(selectEvents(events).at(-1)).toEqual({
        key: "c:A",
        addToSelection: false,
      });
    });

    it("still counts a press that stays under the drag slop toward a double click", () => {
      const a = componentNode("A");
      const { manager, events } = makeManager({ target: a });

      manager.handlePointerDown(
        pointerEvent("pointerdown", { clientX: 0, clientY: 0 }),
      );
      manager.handlePointerMove(
        pointerEvent("pointermove", { clientX: 1, clientY: 0 }),
      );
      manager.handlePointerUp(pointerEvent("pointerup", { clientX: 1 }));

      now += 50;
      manager.handlePointerDown(pointerEvent("pointerdown"));

      expect(doubleClickCount(events)).toBe(1);
    });

    it("does not carry drag invalidation across pointer ids", () => {
      const a = componentNode("A");
      const { manager, events } = makeManager({ target: a });

      // Pointer 1's press stays open (no release yet) while an unrelated
      // pointer 2 travels far — that must not invalidate pointer 1's click.
      manager.handlePointerDown(
        pointerEvent("pointerdown", { pointerId: 1, clientX: 0, clientY: 0 }),
      );
      manager.handlePointerMove(
        pointerEvent("pointermove", {
          pointerId: 2,
          clientX: 999,
          clientY: 999,
        }),
      );
      manager.handlePointerUp(pointerEvent("pointerup", { pointerId: 1 }));

      now += 50;
      manager.handlePointerDown(pointerEvent("pointerdown", { pointerId: 1 }));

      expect(doubleClickCount(events)).toBe(1);
    });

    it("does not count a press abandoned without a release toward a double click", () => {
      // A draw tool armed mid-press swallows the pointerup (ModeRouter routes
      // release to the tool instead of the InteractionManager), so a press
      // can be abandoned without ever reaching handlePointerUp. Whatever that
      // press became, it wasn't observed to be a click, so it must not pair
      // with a later click to fake a double.
      const a = componentNode("A");
      const { manager, events, setTarget } = makeManager({ target: a });

      manager.handlePointerDown(
        pointerEvent("pointerdown", { clientX: 0, clientY: 0 }),
      );

      // The next press misses everything, but must still abandon the previous
      // one, which never released.
      setTarget(null);
      manager.handlePointerDown(
        pointerEvent("pointerdown", { clientX: 0, clientY: 0 }),
      );
      setTarget(a);

      now += 50;
      manager.handlePointerDown(pointerEvent("pointerdown"));

      expect(doubleClickCount(events)).toBe(0);
    });

    it("does not count a normally-released click toward a double click once a miss intervenes", () => {
      // Unlike the abandoned-press case above, this press releases cleanly —
      // the miss must still reset the double-click window on its own, not
      // rely on a tracked press being left open to catch.
      const a = componentNode("A");
      const { manager, events, setTarget } = makeManager({ target: a });

      manager.handlePointerDown(pointerEvent("pointerdown"));
      manager.handlePointerUp(pointerEvent("pointerup"));

      setTarget(null);
      manager.handlePointerDown(pointerEvent("pointerdown"));
      setTarget(a);

      now += 50;
      manager.handlePointerDown(pointerEvent("pointerdown"));

      expect(doubleClickCount(events)).toBe(0);
    });

    it("does not count a cancelled press toward a double click", () => {
      const a = componentNode("A");
      const { manager, events } = makeManager({ target: a });

      manager.handlePointerDown(pointerEvent("pointerdown"));
      manager.handlePointerCancel(pointerEvent("pointercancel"));

      now += 50;
      manager.handlePointerDown(pointerEvent("pointerdown"));
      manager.handlePointerUp(pointerEvent("pointerup"));

      expect(doubleClickCount(events)).toBe(0);
    });

    it("keeps watching a press for drag travel through a secondary press", () => {
      // A right-click mid-press does not retire the primary press: its own
      // drag is still what decides whether it was a click.
      const a = componentNode("A");
      const { manager, events } = makeManager({ target: a });

      manager.handlePointerDown(
        pointerEvent("pointerdown", { clientX: 0, clientY: 0 }),
      );
      manager.handlePointerDown(pointerEvent("pointerdown", { button: 2 }));
      manager.handlePointerUp(pointerEvent("pointerup", { button: 2 }));
      manager.handlePointerMove(
        pointerEvent("pointermove", { clientX: 80, clientY: 0 }),
      );
      manager.handlePointerUp(
        pointerEvent("pointerup", { clientX: 80, clientY: 0 }),
      );

      now += 50;
      manager.handlePointerDown(pointerEvent("pointerdown"));

      expect(doubleClickCount(events)).toBe(0);
    });

    it("does not count a deferred press dropped by the context menu toward a double click", () => {
      // The secondary button opening the menu drops the deferred narrowing
      // (see the "deferred select" tests below) — it must also stop that
      // press from pairing with a later click to fake a double.
      const a = componentNode("A");
      const { manager, events } = makeManager({
        target: a,
        selection: ["c:A", "c:B"],
      });

      manager.handlePointerDown(pointerEvent("pointerdown"));
      manager.handlePointerUp(pointerEvent("pointerup", { button: 2 }));
      manager.handlePointerUp(pointerEvent("pointerup"));

      now += 50;
      manager.handlePointerDown(pointerEvent("pointerdown"));

      expect(doubleClickCount(events)).toBe(0);
    });
  });

  describe("deferred select on a multi-selection member", () => {
    it("defers select to pointerup and drops it if the press drags past the slop", () => {
      const a = componentNode("A");
      const { manager, events } = makeManager({
        target: a,
        selection: ["c:A", "c:B"],
      });

      manager.handlePointerDown(
        pointerEvent("pointerdown", { clientX: 0, clientY: 0 }),
      );
      expect(selectEvents(events)).toEqual([]);

      manager.handlePointerMove(
        pointerEvent("pointermove", { clientX: 50, clientY: 50 }),
      );
      manager.handlePointerUp(
        pointerEvent("pointerup", { clientX: 50, clientY: 50 }),
      );

      expect(selectEvents(events)).toEqual([]);
    });

    it("emits the deferred select on a stationary release", () => {
      const a = componentNode("A");
      const { manager, events } = makeManager({
        target: a,
        selection: ["c:A", "c:B"],
      });

      manager.handlePointerDown(pointerEvent("pointerdown"));
      manager.handlePointerUp(pointerEvent("pointerup"));

      expect(selectEvents(events)).toEqual([
        { key: "c:A", addToSelection: false },
      ]);
    });

    it("drops the deferred select on pointercancel", () => {
      const a = componentNode("A");
      const { manager, events } = makeManager({
        target: a,
        selection: ["c:A", "c:B"],
      });

      manager.handlePointerDown(pointerEvent("pointerdown"));
      manager.handlePointerCancel(pointerEvent("pointercancel"));
      manager.handlePointerUp(pointerEvent("pointerup"));

      expect(selectEvents(events)).toEqual([]);
    });

    it("does not defer when ctrl/cmd is held", () => {
      const a = componentNode("A");
      const { manager, events } = makeManager({
        target: a,
        selection: ["c:A", "c:B"],
      });

      manager.handlePointerDown(pointerEvent("pointerdown", { ctrlKey: true }));

      expect(selectEvents(events)).toEqual([
        { key: "c:A", addToSelection: true },
      ]);
    });
  });

  describe("hover", () => {
    it("emits hover when the entity under the pointer changes", () => {
      const a = componentNode("A");
      const { manager, events } = makeManager({ target: a });

      manager.handlePointerMove(pointerEvent("pointermove"));

      expect(events).toContainEqual({ type: "hover", detail: { key: "c:A" } });
    });

    it("does not re-emit hover for the same key", () => {
      const a = componentNode("A");
      const { manager, events } = makeManager({ target: a });

      manager.handlePointerMove(pointerEvent("pointermove", { clientX: 0 }));
      manager.handlePointerMove(pointerEvent("pointermove", { clientX: 1 }));

      expect(events.filter((e) => e.type === "hover")).toHaveLength(1);
    });

    it("emits hover with a null key on pointer leave", () => {
      const a = componentNode("A");
      const { manager, events } = makeManager({ target: a });

      manager.handlePointerMove(pointerEvent("pointermove"));
      manager.handlePointerLeave();

      expect(events.at(-1)).toEqual({ type: "hover", detail: { key: null } });
    });
  });

  describe("contextMenu", () => {
    it("emits contextMenu on secondary-button release", () => {
      const a = componentNode("A");
      const { manager, events } = makeManager({ target: a });

      manager.handlePointerUp(
        pointerEvent("pointerup", { button: 2, clientX: 12, clientY: 34 }),
      );

      expect(events).toContainEqual({
        type: "contextMenu",
        detail: { key: "c:A", clientX: 12, clientY: 34 },
      });
    });
  });
});
