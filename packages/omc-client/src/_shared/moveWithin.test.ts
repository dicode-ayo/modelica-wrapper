import { describe, expect, it } from "vitest";

import { moveWithin } from "./diagramLayout.js";

describe("moveWithin", () => {
  const abc = ["a", "b", "c"] as const;

  it("removes before inserting, so `to` is the index in the result", () => {
    // The distinction that makes bring-to-front work: moving 0→2 of [a,b,c]
    // lands `a` last, not at input-index 2.
    expect(moveWithin(abc, 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveWithin(abc, 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("steps one slot in either direction", () => {
    expect(moveWithin(abc, 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveWithin(abc, 2, 1)).toEqual(["a", "c", "b"]);
  });

  it("returns a copy rather than mutating the input", () => {
    const input = [...abc];
    expect(moveWithin(input, 0, 2)).not.toBe(input);
    expect(input).toEqual(["a", "b", "c"]);
  });

  it("returns the same order for a move onto itself", () => {
    expect(moveWithin(abc, 1, 1)).toEqual(["a", "b", "c"]);
  });

  it("returns null for an index outside the array", () => {
    expect(moveWithin(abc, 3, 0)).toBeNull();
    expect(moveWithin(abc, 0, 3)).toBeNull();
    expect(moveWithin(abc, -1, 0)).toBeNull();
    expect(moveWithin(abc, 0, -1)).toBeNull();
    expect(moveWithin([], 0, 0)).toBeNull();
  });

  it("returns null for a non-integer index", () => {
    expect(moveWithin(abc, Number.NaN, 0)).toBeNull();
    expect(moveWithin(abc, 0, Number.NaN)).toBeNull();
    expect(moveWithin(abc, 1.5, 0)).toBeNull();
  });
});
