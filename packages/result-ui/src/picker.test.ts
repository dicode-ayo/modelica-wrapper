import { describe, expect, it } from "vitest";

import {
  cascadeLevels,
  optionsAt,
  selectedNode,
  withSelection,
} from "./picker.js";
import { buildVariableTree } from "./var-tree.js";

const tree = buildVariableTree(["time", "motor.w", "motor.i", "load.tau"]);
// roots: load, motor, time ; motor → {i, w} ; load → {tau} ; time is a leaf

describe("optionsAt", () => {
  it("returns roots at level 0", () => {
    expect(optionsAt(tree, [], 0).map((n) => n.name)).toEqual([
      "load",
      "motor",
      "time",
    ]);
  });
  it("returns a node's children at the next level", () => {
    expect(optionsAt(tree, ["motor"], 1).map((n) => n.name)).toEqual([
      "i",
      "w",
    ]);
  });
  it("returns [] when the path doesn't resolve", () => {
    expect(optionsAt(tree, ["nope"], 1)).toEqual([]);
  });
});

describe("cascadeLevels", () => {
  it("opens one level when nothing is chosen", () => {
    const levels = cascadeLevels(tree, []);
    expect(levels).toHaveLength(1);
    expect(levels[0]!.level).toBe(0);
    expect(levels[0]!.current).toBe("");
  });
  it("opens the next level once an interior node is chosen", () => {
    const levels = cascadeLevels(tree, ["motor"]);
    expect(levels.map((l) => l.level)).toEqual([0, 1]);
    expect(levels[0]!.current).toBe("motor");
    expect(levels[1]!.opts.map((n) => n.name)).toEqual(["i", "w"]);
  });
  it("stops at a leaf (no further level)", () => {
    expect(cascadeLevels(tree, ["motor", "w"]).map((l) => l.level)).toEqual([
      0, 1,
    ]);
    expect(cascadeLevels(tree, ["time"]).map((l) => l.level)).toEqual([0]);
  });
});

describe("selectedNode", () => {
  it("is undefined with no selection", () => {
    expect(selectedNode(tree, [])).toBeUndefined();
  });
  it("resolves an interior node (not a leaf)", () => {
    expect(selectedNode(tree, ["motor"])?.isLeaf).toBe(false);
  });
  it("resolves a leaf with its full dotted path", () => {
    const node = selectedNode(tree, ["motor", "w"]);
    expect(node?.isLeaf).toBe(true);
    expect(node?.path).toBe("motor.w");
  });
});

describe("withSelection", () => {
  it("appends at the open level", () => {
    expect(withSelection([], 0, "motor")).toEqual(["motor"]);
    expect(withSelection(["motor"], 1, "w")).toEqual(["motor", "w"]);
  });
  it("truncates and replaces when an earlier level changes", () => {
    expect(withSelection(["motor", "w"], 0, "load")).toEqual(["load"]);
  });
  it("truncates when a level is cleared", () => {
    expect(withSelection(["motor", "w"], 1, "")).toEqual(["motor"]);
  });
});
