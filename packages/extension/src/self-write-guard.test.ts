import { describe, expect, it } from "vitest";

import { createSelfWriteGuard } from "./self-write-guard.js";

describe("SelfWriteGuard", () => {
  it("claims a watcher event whose disk text matches the parked write", () => {
    const guard = createSelfWriteGuard();
    guard.record("/ws/Foo.mo", "model Foo end Foo;");
    expect(guard.claim("/ws/Foo.mo", "model Foo end Foo;")).toBe(true);
  });

  it("does not claim an event for a path it never wrote", () => {
    const guard = createSelfWriteGuard();
    expect(guard.claim("/ws/Bar.mo", "anything")).toBe(false);
  });

  it("treats a divergent disk text as external even for a parked path", () => {
    const guard = createSelfWriteGuard();
    guard.record("/ws/Foo.mo", "model Foo end Foo;");
    // A genuine external edit landed after our write was parked.
    expect(guard.claim("/ws/Foo.mo", "model Foo /* edited */ end Foo;")).toBe(
      false,
    );
  });

  it("consumes the entry so a second identical event is external", () => {
    const guard = createSelfWriteGuard();
    guard.record("/ws/Foo.mo", "model Foo end Foo;");
    expect(guard.claim("/ws/Foo.mo", "model Foo end Foo;")).toBe(true);
    expect(guard.claim("/ws/Foo.mo", "model Foo end Foo;")).toBe(false);
  });

  it("normalizes paths so a differently-spelled event still claims", () => {
    const guard = createSelfWriteGuard();
    guard.record("/ws/pkg/Foo.mo", "model Foo end Foo;");
    expect(guard.claim("/ws/pkg/../pkg/Foo.mo", "model Foo end Foo;")).toBe(
      true,
    );
  });
});
