import { describe, expect, it } from "vitest";

import { ModeRouter, type InteractionMode } from "../src/interaction/mode.js";
import {
  InteractionStateStore,
  type ModeId,
} from "../src/interaction/interaction-state.js";

interface FakeMode extends InteractionMode {
  enters: number;
  exits: number;
  downs: number;
  gesture: boolean;
}

function fakeMode(id: ModeId): FakeMode {
  return {
    id,
    enters: 0,
    exits: 0,
    downs: 0,
    gesture: false,
    onEnter() {
      this.enters += 1;
    },
    onExit() {
      this.exits += 1;
    },
    onPointerDown() {
      this.downs += 1;
    },
    onPointerMove() {},
    onPointerUp() {},
    onPointerLeave() {},
    isGestureActive() {
      return this.gesture;
    },
  };
}

function canvas(): HTMLCanvasElement {
  return document.createElement("canvas");
}

describe("ModeRouter", () => {
  it("enters the selected mode and publishes it to the store", () => {
    const store = new InteractionStateStore();
    const select = fakeMode("select");
    const router = new ModeRouter(
      canvas(),
      new Map([["select", select]]),
      store,
    );

    router.setMode("select");

    expect(select.enters).toBe(1);
    expect(router.activeId).toBe("select");
    expect(store.value.mode).toBe("select");
  });

  it("exits the previous mode and enters the next on a switch", () => {
    const store = new InteractionStateStore();
    const select = fakeMode("select");
    const connect = fakeMode("connect");
    const router = new ModeRouter(
      canvas(),
      new Map([
        ["select", select],
        ["connect", connect],
      ]),
      store,
    );

    router.setMode("select");
    router.setMode("connect");

    expect(select.exits).toBe(1);
    expect(connect.enters).toBe(1);
    expect(store.value.mode).toBe("connect");
  });

  it("is a no-op when re-selecting the active mode", () => {
    const store = new InteractionStateStore();
    const select = fakeMode("select");
    const router = new ModeRouter(
      canvas(),
      new Map([["select", select]]),
      store,
    );

    router.setMode("select");
    router.setMode("select");

    expect(select.enters).toBe(1);
  });

  it("forwards canvas pointer events to the active mode", () => {
    const store = new InteractionStateStore();
    const select = fakeMode("select");
    const c = canvas();
    const router = new ModeRouter(c, new Map([["select", select]]), store);

    router.setMode("select");
    c.dispatchEvent(new PointerEvent("pointerdown", { button: 0 }));

    expect(select.downs).toBe(1);
  });

  it("delegates isGestureActive to the active mode", () => {
    const store = new InteractionStateStore();
    const select = fakeMode("select");
    const router = new ModeRouter(
      canvas(),
      new Map([["select", select]]),
      store,
    );

    router.setMode("select");
    expect(router.isGestureActive()).toBe(false);
    select.gesture = true;
    expect(router.isGestureActive()).toBe(true);
  });

  it("throws when asked for an unregistered mode", () => {
    const store = new InteractionStateStore();
    const router = new ModeRouter(canvas(), new Map(), store);
    expect(() => router.setMode("select")).toThrow(/No interaction mode/);
  });

  it("exits the active mode and stops forwarding on destroy", () => {
    const store = new InteractionStateStore();
    const select = fakeMode("select");
    const c = canvas();
    const router = new ModeRouter(c, new Map([["select", select]]), store);

    router.setMode("select");
    router.destroy();

    expect(select.exits).toBe(1);
    expect(router.activeId).toBeNull();
    c.dispatchEvent(new PointerEvent("pointerdown", { button: 0 }));
    expect(select.downs).toBe(0);
  });
});
