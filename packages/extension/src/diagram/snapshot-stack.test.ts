/**
 * Unit tests for `SnapshotStack` (issue #29, deferred half).
 *
 * Pure host helper — no OMC, no VSCode. Covers push / pop ordering, the
 * best-effort `undefined` skip, capacity capping (oldest dropped), and
 * empty-pop behaviour.
 */

import { describe, expect, it } from "vitest";

import type { OmcSnapshot } from "./omc-snapshot.js";
import {
  DEFAULT_SNAPSHOT_STACK_CAPACITY,
  SnapshotStack,
} from "./snapshot-stack.js";

function snap(tag: string): OmcSnapshot {
  return {
    className: "M",
    filename: "/ws/M.mo",
    contents: `model M\n  // ${tag}\nend M;\n`,
  };
}

describe("SnapshotStack", () => {
  it("starts empty", () => {
    const stack = new SnapshotStack();
    expect(stack.isEmpty).toBe(true);
    expect(stack.size).toBe(0);
    expect(stack.peek()).toBeUndefined();
  });

  it("pops in LIFO order", () => {
    const stack = new SnapshotStack();
    stack.push(snap("a"));
    stack.push(snap("b"));
    expect(stack.size).toBe(2);

    expect(stack.pop()?.contents).toContain("// b");
    expect(stack.pop()?.contents).toContain("// a");
    expect(stack.isEmpty).toBe(true);
  });

  it("pop on an empty stack returns undefined (no throw)", () => {
    const stack = new SnapshotStack();
    expect(stack.pop()).toBeUndefined();
    // Idempotent — still empty, still returns undefined.
    expect(stack.pop()).toBeUndefined();
    expect(stack.isEmpty).toBe(true);
  });

  it("ignores undefined pushes (best-effort capture skip)", () => {
    const stack = new SnapshotStack();
    stack.push(undefined);
    expect(stack.isEmpty).toBe(true);
    stack.push(snap("a"));
    stack.push(undefined);
    expect(stack.size).toBe(1);
    expect(stack.pop()?.contents).toContain("// a");
  });

  it("caps at capacity, dropping the oldest entry", () => {
    const stack = new SnapshotStack(2);
    stack.push(snap("a"));
    stack.push(snap("b"));
    stack.push(snap("c")); // evicts "a"
    expect(stack.size).toBe(2);

    // Most-recent two survive; "a" is gone.
    expect(stack.pop()?.contents).toContain("// c");
    expect(stack.pop()?.contents).toContain("// b");
    expect(stack.isEmpty).toBe(true);
  });

  it("peek inspects without removing", () => {
    const stack = new SnapshotStack();
    stack.push(snap("a"));
    expect(stack.peek()?.contents).toContain("// a");
    expect(stack.size).toBe(1);
  });

  it("clear drops everything", () => {
    const stack = new SnapshotStack();
    stack.push(snap("a"));
    stack.push(snap("b"));
    stack.clear();
    expect(stack.isEmpty).toBe(true);
    expect(stack.pop()).toBeUndefined();
  });

  it("rejects a capacity below 1", () => {
    expect(() => new SnapshotStack(0)).toThrow(/capacity/);
    expect(() => new SnapshotStack(-3)).toThrow(/capacity/);
  });

  it("defaults to the documented capacity", () => {
    expect(DEFAULT_SNAPSHOT_STACK_CAPACITY).toBe(50);
    const stack = new SnapshotStack();
    for (let i = 0; i < DEFAULT_SNAPSHOT_STACK_CAPACITY + 10; i++) {
      stack.push(snap(`s${i}`));
    }
    expect(stack.size).toBe(DEFAULT_SNAPSHOT_STACK_CAPACITY);
  });
});
