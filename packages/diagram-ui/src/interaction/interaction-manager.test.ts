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

  it("does not emit doubleClick once the window has elapsed", () => {
    const a = componentNode("A");
    const { manager, events } = makeManager({ target: a });

    manager.handlePointerDown(pointerEvent("pointerdown"));
    manager.handlePointerUp(pointerEvent("pointerup"));
    now += DOUBLE_CLICK_MS + 1;
    manager.handlePointerDown(pointerEvent("pointerdown"));

    expect(doubleClickCount(events)).toBe(0);
  });

  describe("double-click arming", () => {
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

    it("disarms a press whose release never arrived once a miss intervenes", () => {
      // An armed draw tool swallows the pointerup, so a press can reach no
      // release at all. The miss is what disarms it — a re-press on the same
      // key is indistinguishable from a rapid double click.
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
      // The secondary button opening the menu drops the deferred narrowing —
      // it must also stop that press from pairing with a later click to fake
      // a double.
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

  it("emits hover with a null key on pointer leave", () => {
    // Not asserted anywhere else — the sibling test/interaction-manager.test.ts
    // covers hover-follows-the-picker and hover-dedup, but not leave.
    const a = componentNode("A");
    const { manager, events } = makeManager({ target: a });

    manager.handlePointerMove(pointerEvent("pointermove"));
    manager.handlePointerLeave();

    expect(events.at(-1)).toEqual({ type: "hover", detail: { key: null } });
  });
});
