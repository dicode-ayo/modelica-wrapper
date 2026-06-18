import { describe, expect, it } from "vitest";

import { ModeRouter, type InteractionMode } from "../src/interaction/mode.js";
import {
  InteractionStateStore,
  type ModeId,
} from "../src/interaction/interaction-state.js";

interface FakeMode extends InteractionMode {
  activations: number;
  deactivations: number;
  gesture: boolean;
}

function fakeMode(id: ModeId): FakeMode {
  return {
    id,
    activations: 0,
    deactivations: 0,
    gesture: false,
    activate() {
      this.activations += 1;
    },
    deactivate() {
      this.deactivations += 1;
    },
    isGestureActive() {
      return this.gesture;
    },
  };
}

describe("ModeRouter", () => {
  it("activates the selected mode and publishes it to the store", () => {
    const store = new InteractionStateStore();
    const select = fakeMode("select");
    const router = new ModeRouter(new Map([["select", select]]), store);

    router.setMode("select");

    expect(select.activations).toBe(1);
    expect(router.activeId).toBe("select");
    expect(store.value.mode).toBe("select");
  });

  it("deactivates the previous mode on a switch", () => {
    const store = new InteractionStateStore();
    const select = fakeMode("select");
    const connect = fakeMode("connect");
    const router = new ModeRouter(
      new Map([
        ["select", select],
        ["connect", connect],
      ]),
      store,
    );

    router.setMode("select");
    router.setMode("connect");

    expect(select.deactivations).toBe(1);
    expect(connect.activations).toBe(1);
    expect(store.value.mode).toBe("connect");
  });

  it("is a no-op when re-selecting the active mode", () => {
    const store = new InteractionStateStore();
    const select = fakeMode("select");
    const router = new ModeRouter(new Map([["select", select]]), store);

    router.setMode("select");
    router.setMode("select");

    expect(select.activations).toBe(1);
  });

  it("delegates isGestureActive to the active mode", () => {
    const store = new InteractionStateStore();
    const select = fakeMode("select");
    const router = new ModeRouter(new Map([["select", select]]), store);

    router.setMode("select");
    expect(router.isGestureActive()).toBe(false);
    select.gesture = true;
    expect(router.isGestureActive()).toBe(true);
  });

  it("deactivates the active mode on destroy", () => {
    const store = new InteractionStateStore();
    const select = fakeMode("select");
    const router = new ModeRouter(new Map([["select", select]]), store);

    router.setMode("select");
    router.destroy();

    expect(select.deactivations).toBe(1);
    expect(router.activeId).toBeNull();
  });
});
