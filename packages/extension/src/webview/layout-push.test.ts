import { describe, expect, it } from "vitest";
import { LayoutPushReceiver } from "./layout-push.js";

function setup() {
  const state = { canApply: true };
  const adopted: number[] = [];
  let clears = 0;
  const receiver = new LayoutPushReceiver({
    canApply: () => state.canApply,
    adopt: (p) => adopted.push(p.layoutVersion),
    clearShapeSelection: () => {
      clears += 1;
    },
  });
  return { state, adopted, receiver, clears: () => clears };
}

describe("LayoutPushReceiver", () => {
  it("clears the shape selection when an adopted push is rejected", () => {
    const t = setup();
    t.receiver.receive({ layoutVersion: 2, rejected: true });
    expect(t.adopted).toEqual([2]);
    expect(t.clears()).toBe(1);
  });

  it("keeps the clear owed when the rejected push is refused, and pays it on the next adopted push without a flag", () => {
    const t = setup();
    t.state.canApply = false;
    t.receiver.receive({ layoutVersion: 2, rejected: true });
    expect(t.adopted).toEqual([]);
    expect(t.clears()).toBe(0);

    t.state.canApply = true;
    t.receiver.receive({ layoutVersion: 3 });
    expect(t.adopted).toEqual([3]);
    expect(t.clears()).toBe(1);

    t.receiver.receive({ layoutVersion: 4 });
    expect(t.clears()).toBe(1);
  });

  it("does not clear on a plain push", () => {
    const t = setup();
    t.receiver.receive({ layoutVersion: 2 });
    expect(t.clears()).toBe(0);
  });
});
