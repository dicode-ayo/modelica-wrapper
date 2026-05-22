import { describe, expect, it } from "vitest";

import { buildVariableTree } from "./var-tree.js";

describe("buildVariableTree", () => {
  it("returns an empty array for no variables", () => {
    expect(buildVariableTree([])).toEqual([]);
  });

  it("groups dotted names into a hierarchy", () => {
    const tree = buildVariableTree(["motor.w", "motor.i", "tank.level"]);
    expect(tree.map((n) => n.name)).toEqual(["motor", "tank"]);
    const motor = tree[0]!;
    expect(motor.isLeaf).toBe(false);
    expect(motor.children.map((c) => c.name)).toEqual(["i", "w"]); // sorted
    expect(motor.children.every((c) => c.isLeaf)).toBe(true);
    expect(motor.children[1]!.path).toBe("motor.w");
  });

  it("marks a node that is both an interior node and a leaf", () => {
    const tree = buildVariableTree(["a.b", "a.b.c"]);
    const b = tree[0]!.children[0]!;
    expect(b.path).toBe("a.b");
    expect(b.isLeaf).toBe(true); // a.b is itself a variable
    expect(b.children.map((c) => c.path)).toEqual(["a.b.c"]);
    expect(b.children[0]!.isLeaf).toBe(true);
  });

  it("collapses duplicates and sorts every level", () => {
    expect(buildVariableTree(["b", "a", "a"]).map((n) => n.name)).toEqual(["a", "b"]);
  });

  it("keeps array subscripts attached to their segment", () => {
    const tree = buildVariableTree(["body[1].r", "body[1].v"]);
    expect(tree.map((n) => n.name)).toEqual(["body[1]"]);
    expect(tree[0]!.children.map((c) => c.path)).toEqual(["body[1].r", "body[1].v"]);
  });
});
