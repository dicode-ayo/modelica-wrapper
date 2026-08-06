import { describe, expect, it, vi } from "vitest";

import { ClassInvalidationRegistry } from "./invalidation.js";

describe("ClassInvalidationRegistry", () => {
  it("fans one change out to every registered listener", () => {
    const registry = new ClassInvalidationRegistry();
    const first = vi.fn();
    const second = vi.fn();
    registry.register(first);
    registry.register(second);

    registry.classChanged("Lib.A");

    expect(first.mock.calls).toEqual([["Lib.A"]]);
    expect(second.mock.calls).toEqual([["Lib.A"]]);
  });

  it("stops delivering to a disposed listener", () => {
    const registry = new ClassInvalidationRegistry();
    const listener = vi.fn();
    registry.register(listener).dispose();

    registry.classChanged("Lib.A");

    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps fanning out past a listener that throws", () => {
    const registry = new ClassInvalidationRegistry();
    const later = vi.fn();
    registry.register(() => {
      throw new Error("cache exploded");
    });
    registry.register(later);

    expect(() => registry.classChanged("Lib.A")).not.toThrow();
    expect(later).toHaveBeenCalledWith("Lib.A");
  });

  it("does not deliver the in-progress change to a listener registered during it", () => {
    const registry = new ClassInvalidationRegistry();
    const late = vi.fn();
    registry.register(() => {
      registry.register(late);
    });

    registry.classChanged("Lib.A");

    expect(late).not.toHaveBeenCalled();
  });
});
