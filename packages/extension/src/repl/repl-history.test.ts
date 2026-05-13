/**
 * Unit tests for the REPL history walker. Independent of `vscode` so we
 * can exercise the Up/Up/Down/Down sequence the spec explicitly calls out.
 */

import { describe, expect, it } from "vitest";

import { MAX_HISTORY, ReplHistory } from "./repl-history.js";

describe("ReplHistory", () => {
  it("ignores empty pushes and collapses consecutive dupes", () => {
    const h = new ReplHistory();
    h.push("");
    h.push("a");
    h.push("a");
    h.push("b");
    h.push("b");
    h.push("a");
    expect(h.size()).toBe(3); // a, b, a
  });

  it("Up walks back, Down walks forward and restores the draft past the tail", () => {
    const h = new ReplHistory();
    h.push("first");
    h.push("second");
    h.push("third");
    // Simulates: user is mid-typing "draft", presses Up Up Down Down.
    expect(h.up("draft")).toBe("third"); // first Up — saves draft
    expect(h.up("anything")).toBe("second"); // second Up — ignores live arg
    expect(h.down("anything")).toBe("third"); // back one
    expect(h.down("anything")).toBe("draft"); // past tail — draft restored
    // Walk reset — Down with no walk in progress is a no-op.
    expect(h.isWalking()).toBe(false);
    expect(h.down("idle")).toBe("idle");
  });

  it("Up at the oldest entry stays there", () => {
    const h = new ReplHistory();
    h.push("a");
    h.push("b");
    expect(h.up("")).toBe("b");
    expect(h.up("")).toBe("a");
    expect(h.up("")).toBe("a"); // bottom — sticky
  });

  it("Down without a walk in progress returns the current draft unchanged", () => {
    const h = new ReplHistory();
    h.push("x");
    expect(h.down("mid-type")).toBe("mid-type");
  });

  it("push() resets the walk", () => {
    const h = new ReplHistory();
    h.push("a");
    h.push("b");
    h.up("draft");
    expect(h.isWalking()).toBe(true);
    h.push("c");
    expect(h.isWalking()).toBe(false);
    // Saved draft is forgotten — Down from a fresh walk returns the
    // entries, not "draft".
    expect(h.up("new-draft")).toBe("c");
    expect(h.down("ignored")).toBe("new-draft");
  });

  it("bounds the buffer at MAX_HISTORY entries", () => {
    const h = new ReplHistory();
    for (let i = 0; i < MAX_HISTORY + 50; i++) {
      h.push(`cmd-${i}`);
    }
    expect(h.size()).toBe(MAX_HISTORY);
    // Oldest dropped — the most-recent is "cmd-(N-1)".
    expect(h.up("")).toBe(`cmd-${MAX_HISTORY + 50 - 1}`);
  });
});
