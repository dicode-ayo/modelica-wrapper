import { describe, expect, it } from "vitest";

import {
  formatComponentKey,
  formatConnectorKey,
  formatKey,
  formatShapeKey,
  formatVertexKey,
  isNestedConnector,
  parseKey,
  vertexShapeKey,
  type EntityKey,
  type EntityKind,
} from "../src/interaction/entity-keys.js";

/**
 * One sample per kind, keyed by `EntityKind` so a newly declared kind
 * fails to compile until it is round-tripped here too.
 */
const SAMPLES: Record<EntityKind, { nodeId: string; decoded: EntityKey }> = {
  component: { nodeId: "R1", decoded: { kind: "component", nodeId: "R1" } },
  connector: {
    nodeId: "R1.p",
    decoded: {
      kind: "connector",
      nodeId: "R1.p",
      componentName: "R1",
      portName: "p",
    },
  },
  shape: {
    nodeId: "rectangle:3",
    decoded: {
      kind: "shape",
      nodeId: "rectangle:3",
      shapeKind: "rectangle",
      index: 3,
    },
  },
  edge: {
    nodeId: "0",
    decoded: { kind: "edge", nodeId: "0", connIndex: 0 },
  },
  junction: {
    nodeId: "2/1",
    decoded: {
      kind: "junction",
      nodeId: "2/1",
      connIndex: 2,
      waypointIndex: 1,
    },
  },
  label: { nodeId: "lbl0", decoded: { kind: "label", nodeId: "lbl0" } },
  port: { nodeId: "p", decoded: { kind: "port", nodeId: "p" } },
  handle: { nodeId: "tl", decoded: { kind: "handle", nodeId: "tl" } },
  "rotate-handle": {
    nodeId: "R1",
    decoded: { kind: "rotate-handle", nodeId: "R1" },
  },
  "vertex-handle": {
    nodeId: "line:1/2",
    decoded: {
      kind: "vertex-handle",
      nodeId: "line:1/2",
      shapeKind: "line",
      shapeIndex: 1,
      vertexIndex: 2,
    },
  },
};

describe("formatKey / parseKey", () => {
  it("round-trips every kind", () => {
    for (const [kind, { nodeId, decoded }] of Object.entries(SAMPLES) as [
      EntityKind,
      { nodeId: string; decoded: EntityKey },
    ][]) {
      expect(parseKey(formatKey(kind, nodeId))).toEqual(decoded);
    }
  });

  it("gives every kind a distinct wire prefix", () => {
    const kinds = Object.keys(SAMPLES) as EntityKind[];
    const prefixes = kinds.map((kind) => formatKey(kind, "x").split(":")[0]);
    expect(new Set(prefixes).size).toBe(kinds.length);
  });

  it("decomposes standalone connector keys into a null componentName", () => {
    expect(parseKey(formatKey("connector", "p"))).toEqual({
      kind: "connector",
      nodeId: "p",
      componentName: null,
      portName: "p",
    });
  });

  it("returns null for unrecognised prefixes and missing colons", () => {
    expect(parseKey("nope:foo")).toBeNull();
    expect(parseKey("noColon")).toBeNull();
  });

  it("keeps the index a number across the kinds the panel/handles branch on", () => {
    for (const kind of ["ellipse", "line", "polygon", "text", "bitmap"]) {
      expect(parseKey(formatShapeKey(kind, 0))).toMatchObject({
        kind: "shape",
        shapeKind: kind,
        index: 0,
      });
    }
  });

  it("fails closed on a malformed shape index instead of addressing shape 0", () => {
    // `Number("")` is 0 — a trailing-colon key must not resolve to a real shape.
    for (const bad of ["shape:rectangle:", "shape:rectangle:abc"]) {
      expect(parseKey(bad)).toMatchObject({ kind: "shape", index: NaN });
    }
  });

  it("fails closed on a malformed vertex key rather than addressing slot 0", () => {
    expect(parseKey("vtx:line:1")).toMatchObject({ vertexIndex: NaN });
    expect(parseKey("vtx:line:1/x")).toMatchObject({ vertexIndex: NaN });
    expect(parseKey("vtx:line:/2")).toMatchObject({ shapeIndex: NaN });
  });

  it("fails closed on a malformed edge key rather than addressing connection 0", () => {
    expect(parseKey("edge:")).toMatchObject({ kind: "edge", connIndex: NaN });
    expect(parseKey("edge:1.5")).toMatchObject({
      kind: "edge",
      connIndex: NaN,
    });
  });

  it("fails closed on a malformed junction key", () => {
    expect(parseKey("junc:2")).toMatchObject({ waypointIndex: NaN });
    expect(parseKey("junc:x/1")).toMatchObject({ connIndex: NaN });
  });

  it("narrows on `kind` so consumers reach kind-specific fields", () => {
    const conn = parseKey("k:R1.p");
    if (conn?.kind !== "connector") throw new Error("expected a connector key");
    expect(conn.componentName).toBe("R1");
    expect(conn.portName).toBe("p");
    expect(isNestedConnector(conn)).toBe(true);

    const shape = parseKey("shape:polygon:1");
    if (shape?.kind !== "shape") throw new Error("expected a shape key");
    expect(shape.shapeKind).toBe("polygon");
    expect(shape.index).toBe(1);
  });

  it("isNestedConnector is false for standalone connectors", () => {
    const conn = parseKey("k:p");
    if (conn?.kind !== "connector") throw new Error("expected a connector key");
    expect(isNestedConnector(conn)).toBe(false);
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

  it("formatShapeKey writes a `shape:<kind>:<index>` wire key", () => {
    expect(formatShapeKey("ellipse", 2)).toBe("shape:ellipse:2");
  });

  it("formatVertexKey writes a `vtx:<kind>:<shape>/<vertex>` wire key", () => {
    expect(formatVertexKey("polygon", 3, 4)).toBe("vtx:polygon:3/4");
  });

  it("vertexShapeKey derives the owning shape key from a vertex", () => {
    const key = parseKey("vtx:line:2/1");
    if (key?.kind !== "vertex-handle") throw new Error("expected a vertex key");
    expect(vertexShapeKey(key)).toBe("shape:line:2");
  });
});
