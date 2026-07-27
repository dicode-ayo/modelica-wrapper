import { describe, expect, it } from "vitest";

import { assertUnreachable } from "./assert-unreachable.js";

type Shape = { kind: "circle" } | { kind: "square" };

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return 1;
    case "square":
      return 2;
    default:
      return assertUnreachable(shape, "Shape");
  }
}

describe("assertUnreachable", () => {
  it("stays out of the way while the union is covered", () => {
    expect(area({ kind: "circle" })).toBe(1);
    expect(area({ kind: "square" })).toBe(2);
  });

  it("throws naming the subject and the value that fell through", () => {
    // Only reachable when something bypassed the type system, which is the
    // case worth a legible error rather than a silent fallthrough.
    const rogue = { kind: "triangle" } as unknown as never;
    expect(() => area(rogue)).toThrowError(
      'Unreachable: unhandled Shape {"kind":"triangle"}',
    );
  });

  it("reports the value when no subject is given", () => {
    expect(() => assertUnreachable("x" as unknown as never)).toThrowError(
      'Unreachable: unhandled "x"',
    );
  });

  it("survives a value JSON can't render", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => assertUnreachable(cyclic as unknown as never)).toThrowError(
      /Unreachable: unhandled/,
    );
  });

  it("renders undefined rather than dropping the suffix", () => {
    // `JSON.stringify(undefined)` is `undefined`, not a string — the `??`
    // fallback is what keeps the message intact.
    expect(() => assertUnreachable(undefined as never)).toThrowError(
      "Unreachable: unhandled undefined",
    );
  });
});
