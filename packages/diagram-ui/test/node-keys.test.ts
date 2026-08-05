import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";

import type { EntityKind } from "../src/interaction/entity-keys.js";
import { entityKeyForNode, tagEntity } from "../src/interaction/node-keys.js";

/** A tagged Container — the identity side-channel producers use in prod. */
function tagged(kind: EntityKind, nodeId: string): Container {
  const c = new Container();
  tagEntity(c, kind, nodeId);
  return c;
}

describe("entityKeyForNode", () => {
  it("resolves a tagged container directly", () => {
    const c = tagged("component", "R1");
    expect(entityKeyForNode(c)).toEqual({ kind: "component", nodeId: "R1" });
  });

  it("resolves a host shape from its 'om-shape:<kind>:<index>' wrapper", () => {
    const wrapper = tagged("shape", "rectangle:0");
    const hitPlane = new Container();
    wrapper.addChild(hitPlane);
    expect(entityKeyForNode(hitPlane)).toEqual({
      kind: "shape",
      nodeId: "rectangle:0",
      shapeKind: "rectangle",
      index: 0,
    });
  });

  it("resolves an edge container through its tag", () => {
    const c = tagged("edge", "e1");
    expect(entityKeyForNode(c)).toEqual({ kind: "edge", nodeId: "e1" });
  });

  it("resolves a vertex dot to a self-describing vertex key", () => {
    const wrapper = tagged("shape", "line:2");
    const dot = tagged("vertex-handle", "line:2/1");
    wrapper.addChild(dot);
    // The dot carries its whole identity — shape kind, shape index, vertex.
    expect(entityKeyForNode(dot)).toEqual({
      kind: "vertex-handle",
      nodeId: "line:2/1",
      shapeKind: "line",
      shapeIndex: 2,
      vertexIndex: 1,
    });
  });

  it("walks up the chain to the nearest tagged ancestor", () => {
    const parent = tagged("component", "R2");
    const child = new Container();
    parent.addChild(child);
    const grandchild = new Container();
    child.addChild(grandchild);
    expect(entityKeyForNode(grandchild)).toEqual({
      kind: "component",
      nodeId: "R2",
    });
  });

  it("qualifies a nested connector with its parent component and decomposes the parts", () => {
    const comp = tagged("component", "R3");
    const conn = tagged("connector", "p");
    comp.addChild(conn);
    expect(entityKeyForNode(conn)).toEqual({
      kind: "connector",
      nodeId: "R3.p",
      componentName: "R3",
      portName: "p",
    });
  });

  it("returns a standalone connector when no component ancestor is found", () => {
    const conn = tagged("connector", "p");
    expect(entityKeyForNode(conn)).toEqual({
      kind: "connector",
      nodeId: "p",
      componentName: null,
      portName: "p",
    });
  });

  it("returns null when nothing in the chain is tagged", () => {
    expect(entityKeyForNode(new Container())).toBeNull();
  });
});
