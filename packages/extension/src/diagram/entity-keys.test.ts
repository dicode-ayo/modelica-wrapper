import { describe, expect, it } from "vitest";

import {
  ENTITY_KINDS,
  formatKey,
  parseKey,
  type EntityKey,
  type EntityKind,
} from "@dicode/diagram-ui/entity-keys";

/**
 * Every kind the webview can emit must decode here too — an unknown prefix
 * parses to `null`, which reaches the host as "nothing was clicked" rather
 * than as an error. The extension tsconfig never typechecks test files, so
 * completeness is enforced at runtime by walking `ENTITY_KINDS`; the
 * compile-time twin lives in `diagram-ui/test/entity-keys.test.ts`.
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

describe("entity keys, host side", () => {
  it("round-trips every kind", () => {
    for (const kind of ENTITY_KINDS) {
      const sample = SAMPLES[kind];
      expect(sample, `missing sample for kind "${kind}"`).toBeDefined();
      expect(parseKey(formatKey(kind, sample.nodeId))).toEqual(sample.decoded);
    }
  });

  it("resolves the handle kinds the webview emits", () => {
    expect(parseKey("vtx:line:1/2")).toMatchObject({ kind: "vertex-handle" });
    expect(parseKey("rot:R1")).toMatchObject({ kind: "rotate-handle" });
  });

  it("returns null for unrecognised prefixes and missing colons", () => {
    expect(parseKey("nope:foo")).toBeNull();
    expect(parseKey("noColon")).toBeNull();
  });
});
