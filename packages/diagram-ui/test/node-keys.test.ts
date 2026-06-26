import { describe, expect, it } from "vitest";
import { NullEngine, Scene, TransformNode, Mesh } from "@babylonjs/core";

import {
  entityKeyForNode,
  formatComponentKey,
  formatConnectorKey,
  formatKey,
  formatShapeKey,
  formatVertexKey,
  isComponentKey,
  isConnectorKey,
  isEdgeKey,
  isHandleKey,
  isNestedConnector,
  isShapeKey,
  parseKey,
  vertexShapeKey,
} from "../src/interaction/node-keys.js";

function makeScene(): { scene: Scene; dispose: () => void } {
  const engine = new NullEngine({
    renderWidth: 100,
    renderHeight: 100,
    textureSize: 64,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  const scene = new Scene(engine);
  return {
    scene,
    dispose: () => {
      scene.dispose();
      engine.dispose();
    },
  };
}

describe("formatKey / parseKey", () => {
  it("round-trips simple kinds (no decomposition)", () => {
    for (const [kind, id] of [
      ["component", "R1"],
      ["edge", "e0"],
      ["junction", "j0"],
      ["label", "lbl0"],
      ["port", "p"],
      ["handle", "tl"],
    ] as const) {
      const parsed = parseKey(formatKey(kind, id));
      expect(parsed).toEqual({ kind, nodeId: id });
    }
  });

  it("decomposes standalone connector keys into a null componentName", () => {
    const parsed = parseKey(formatKey("connector", "p"));
    expect(parsed).toEqual({
      kind: "connector",
      nodeId: "p",
      componentName: null,
      portName: "p",
    });
  });

  it("decomposes nested connector keys into componentName + portName", () => {
    const parsed = parseKey(formatKey("connector", "R1.p"));
    expect(parsed).toEqual({
      kind: "connector",
      nodeId: "R1.p",
      componentName: "R1",
      portName: "p",
    });
  });

  it("returns null for unrecognised prefixes and missing colons", () => {
    expect(parseKey("nope:foo")).toBeNull();
    expect(parseKey("noColon")).toBeNull();
  });

  it("decomposes a shape key into its primitive kind and own-layer index", () => {
    const parsed = parseKey(formatShapeKey("rectangle", 3));
    expect(parsed).toEqual({
      kind: "shape",
      nodeId: "rectangle:3",
      shapeKind: "rectangle",
      index: 3,
    });
  });

  it("keeps the index a number across the kinds the panel/handles branch on", () => {
    for (const kind of ["ellipse", "line", "polygon", "text", "bitmap"]) {
      const parsed = parseKey(formatShapeKey(kind, 0));
      expect(parsed).toMatchObject({
        kind: "shape",
        shapeKind: kind,
        index: 0,
      });
    }
  });

  it("fails closed on a malformed shape index instead of addressing shape 0", () => {
    // `Number("")` is 0 — a trailing-colon key must not resolve to a real shape.
    for (const bad of ["shape:rectangle:", "shape:rectangle:abc"]) {
      const parsed = parseKey(bad);
      expect(parsed).toMatchObject({ kind: "shape" });
      if (!parsed || parsed.kind !== "shape") throw new Error("unreachable");
      expect(parsed.index).toBeNaN();
    }
  });
});

describe("format helpers", () => {
  it("formatComponentKey writes a component wire key", () => {
    expect(formatComponentKey("R1")).toBe("c:R1");
  });

  it("formatConnectorKey writes both standalone and nested forms", () => {
    expect(formatConnectorKey(null, "p")).toBe("k:p");
    expect(formatConnectorKey("R1", "p")).toBe("k:R1.p");
  });

  it("formatConnectorKey round-trips through parseKey", () => {
    const parsed = parseKey(formatConnectorKey("R1", "p"));
    expect(parsed).toMatchObject({
      kind: "connector",
      componentName: "R1",
      portName: "p",
    });
  });

  it("formatShapeKey writes a `shape:<kind>:<index>` wire key", () => {
    expect(formatShapeKey("ellipse", 2)).toBe("shape:ellipse:2");
  });
});

describe("type guards", () => {
  it("narrow each branch so consumers can access kind-specific fields", () => {
    const conn = parseKey("k:R1.p");
    if (conn && isConnectorKey(conn)) {
      // TS narrowing — these fields exist only on ConnectorKey:
      expect(conn.componentName).toBe("R1");
      expect(conn.portName).toBe("p");
      expect(isNestedConnector(conn)).toBe(true);
    } else {
      throw new Error("expected a ConnectorKey");
    }

    const comp = parseKey("c:R1");
    expect(comp && isComponentKey(comp)).toBe(true);
    expect(comp && isConnectorKey(comp)).toBe(false);

    const edge = parseKey("edge:e0");
    expect(edge && isEdgeKey(edge)).toBe(true);

    const handle = parseKey("h:tl");
    expect(handle && isHandleKey(handle)).toBe(true);

    const shape = parseKey("shape:polygon:1");
    if (shape && isShapeKey(shape)) {
      // TS narrowing — these fields exist only on ShapeKey:
      expect(shape.shapeKind).toBe("polygon");
      expect(shape.index).toBe(1);
    } else {
      throw new Error("expected a ShapeKey");
    }
    expect(comp && isShapeKey(comp)).toBe(false);
  });

  it("isNestedConnector is false for standalone connectors", () => {
    const conn = parseKey("k:p");
    if (!conn || !isConnectorKey(conn)) throw new Error("unreachable");
    expect(isNestedConnector(conn)).toBe(false);
  });
});

describe("entityKeyForNode", () => {
  it("recognises a TransformNode by 'om-<kind>:<id>' naming", () => {
    const { scene, dispose } = makeScene();
    const t = new TransformNode("om-component:R1", scene);
    expect(entityKeyForNode(t)).toEqual({ kind: "component", nodeId: "R1" });
    dispose();
  });

  it("recognises a host shape by its 'om-shape:<kind>:<index>' wrapper name", () => {
    const { scene, dispose } = makeScene();
    const wrapper = new TransformNode("om-shape:rectangle:0", scene);
    const hitPlane = new Mesh("hit", scene);
    hitPlane.parent = wrapper;
    expect(entityKeyForNode(hitPlane)).toEqual({
      kind: "shape",
      nodeId: "rectangle:0",
      shapeKind: "rectangle",
      index: 0,
    });
    dispose();
  });

  it("recognises a Mesh through its metadata", () => {
    const { scene, dispose } = makeScene();
    const m = new Mesh("anything", scene);
    m.metadata = { kind: "edge", nodeId: "e1" };
    expect(entityKeyForNode(m)).toEqual({ kind: "edge", nodeId: "e1" });
    dispose();
  });

  it("resolves a vertex dot to a self-describing vertex key", () => {
    const { scene, dispose } = makeScene();
    const wrapper = new TransformNode("om-shape:line:2", scene);
    const dot = new Mesh("om-vertex-handle", scene);
    dot.parent = wrapper;
    dot.metadata = { kind: "vertex-handle", nodeId: "line:2/1" };
    // The dot carries its whole identity — shape kind, shape index, vertex.
    const key = entityKeyForNode(dot);
    expect(key).toEqual({
      kind: "vertex-handle",
      nodeId: "line:2/1",
      shapeKind: "line",
      shapeIndex: 2,
      vertexIndex: 1,
    });
    // …so the owning shape is derivable from the key, no chain walk.
    expect(key?.kind === "vertex-handle" && vertexShapeKey(key)).toBe(
      "shape:line:2",
    );
    dispose();
  });

  it("round-trips a vertex key through format + parse", () => {
    expect(formatVertexKey("polygon", 3, 4)).toBe("vtx:polygon:3/4");
    expect(parseKey("vtx:polygon:3/4")).toEqual({
      kind: "vertex-handle",
      nodeId: "polygon:3/4",
      shapeKind: "polygon",
      shapeIndex: 3,
      vertexIndex: 4,
    });
  });

  it("walks parents up the chain", () => {
    const { scene, dispose } = makeScene();
    const parent = new TransformNode("om-component:R2", scene);
    const child = new TransformNode("om-port:dot", scene);
    child.parent = parent;
    const grandchild = new Mesh("dot-mesh", scene);
    grandchild.parent = child;
    expect(entityKeyForNode(grandchild)).toEqual({
      kind: "component",
      nodeId: "R2",
    });
    dispose();
  });

  it("qualifies a nested connector with its parent component and decomposes the parts", () => {
    const { scene, dispose } = makeScene();
    const comp = new TransformNode("om-component:R3", scene);
    const conn = new TransformNode("om-connector:p", scene);
    conn.parent = comp;
    const found = entityKeyForNode(conn);
    expect(found).toEqual({
      kind: "connector",
      nodeId: "R3.p",
      componentName: "R3",
      portName: "p",
    });
    dispose();
  });

  it("returns a standalone connector when no component ancestor is found", () => {
    const { scene, dispose } = makeScene();
    const conn = new TransformNode("om-connector:p", scene);
    expect(entityKeyForNode(conn)).toEqual({
      kind: "connector",
      nodeId: "p",
      componentName: null,
      portName: "p",
    });
    dispose();
  });

  it("returns null when nothing in the chain is tagged", () => {
    const { scene, dispose } = makeScene();
    const t = new TransformNode("plain", scene);
    expect(entityKeyForNode(t)).toBeNull();
    dispose();
  });
});
