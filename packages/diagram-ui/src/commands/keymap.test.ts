import { describe, expect, it } from "vitest";
import { DEFAULT_KEYMAP } from "./diagram-commands.js";
import { detectConflicts, resolveKeymap } from "./keymap.js";

describe("resolveKeymap", () => {
  it("returns the base unchanged when overrides is empty", () => {
    const result = resolveKeymap(DEFAULT_KEYMAP, new Map());
    expect(result).toBe(DEFAULT_KEYMAP);
  });

  it("adds a new chord from an override", () => {
    const result = resolveKeymap(
      DEFAULT_KEYMAP,
      new Map([["ctrl+d", "diagram.delete"]]),
    );
    expect(result.get("ctrl+d")).toBe("diagram.delete");
    expect(result.get("Delete")).toBe("diagram.delete");
  });

  it("replaces an existing chord's command", () => {
    const result = resolveKeymap(
      DEFAULT_KEYMAP,
      new Map([["r", "diagram.flipHorizontal"]]),
    );
    expect(result.get("r")).toBe("diagram.flipHorizontal");
  });

  it("unbinds a chord when the override value is null", () => {
    const result = resolveKeymap(DEFAULT_KEYMAP, new Map([["Delete", null]]));
    expect(result.has("Delete")).toBe(false);
    expect(result.get("Backspace")).toBe("diagram.delete");
  });

  it("does not mutate the base map", () => {
    const base = new Map(DEFAULT_KEYMAP);
    resolveKeymap(base, new Map([["ctrl+z", "diagram.delete"]]));
    expect(base.has("ctrl+z")).toBe(false);
  });
});

describe("detectConflicts", () => {
  it("returns empty when there are no conflicts", () => {
    const conflicts = detectConflicts(
      new Map([["ctrl+d", "diagram.delete"]]),
      DEFAULT_KEYMAP,
    );
    expect(conflicts).toHaveLength(0);
  });

  it("detects a chord already bound to a different command in the base", () => {
    const conflicts = detectConflicts(
      new Map([["r", "diagram.delete"]]),
      DEFAULT_KEYMAP,
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      chord: "r",
      newId: "diagram.delete",
      existingId: "diagram.rotateCw",
    });
  });

  it("does not flag an unbind override as a conflict", () => {
    const conflicts = detectConflicts(
      new Map([["Delete", null]]),
      DEFAULT_KEYMAP,
    );
    expect(conflicts).toHaveLength(0);
  });

  it("does not flag when the override assigns the same command already there", () => {
    const conflicts = detectConflicts(
      new Map([["Delete", "diagram.delete"]]),
      DEFAULT_KEYMAP,
    );
    expect(conflicts).toHaveLength(0);
  });

  it("detects a conflict when a new override shadows a prior override on the same chord", () => {
    const working = new Map<string, string | null>([
      ["ctrl+d", "diagram.delete"],
    ]);
    const firstConflicts = detectConflicts(working, DEFAULT_KEYMAP);
    expect(firstConflicts).toHaveLength(0);

    const baseWithFirst = new Map(DEFAULT_KEYMAP);
    baseWithFirst.set("ctrl+d", "diagram.delete");
    const secondConflicts = detectConflicts(
      new Map([["ctrl+d", "diagram.rotateCw"]]),
      baseWithFirst,
    );
    expect(secondConflicts).toHaveLength(1);
    expect(secondConflicts[0]).toMatchObject({
      chord: "ctrl+d",
      newId: "diagram.rotateCw",
      existingId: "diagram.delete",
    });
  });
});
