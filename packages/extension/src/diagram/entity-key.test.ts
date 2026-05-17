import { describe, expect, it } from "vitest";

import {
  formatEntityKey,
  isComponentKey,
  isConnectorKey,
  isEdgeKey,
  parseEntityKey,
} from "./entity-key.js";

describe("parseEntityKey", () => {
  it("returns null for unrecognised prefixes and missing colons", () => {
    expect(parseEntityKey("noColon")).toBeNull();
    expect(parseEntityKey("nope:foo")).toBeNull();
  });

  it("returns a flat shape for non-connector kinds", () => {
    expect(parseEntityKey("c:R1")).toEqual({ kind: "component", nodeId: "R1" });
    expect(parseEntityKey("edge:e0")).toEqual({ kind: "edge", nodeId: "e0" });
    expect(parseEntityKey("h:tl")).toEqual({ kind: "handle", nodeId: "tl" });
  });

  it("decomposes standalone connector keys (componentName === null)", () => {
    expect(parseEntityKey("k:p")).toEqual({
      kind: "connector",
      nodeId: "p",
      componentName: null,
      portName: "p",
    });
  });

  it("decomposes nested connector keys into componentName + portName", () => {
    expect(parseEntityKey("k:R1.p")).toEqual({
      kind: "connector",
      nodeId: "R1.p",
      componentName: "R1",
      portName: "p",
    });
  });

  it("matches the diagram-ui format helpers' wire shape", () => {
    // Equivalent to `formatConnectorKey("R1", "p")` on the webview side.
    expect(formatEntityKey("connector", "R1.p")).toBe("k:R1.p");
    expect(formatEntityKey("component", "R1")).toBe("c:R1");
  });
});

describe("type guards", () => {
  it("narrow each branch so callers can access kind-specific fields", () => {
    const conn = parseEntityKey("k:R1.p");
    if (conn && isConnectorKey(conn)) {
      expect(conn.componentName).toBe("R1");
      expect(conn.portName).toBe("p");
    } else {
      throw new Error("expected a ConnectorKey");
    }

    const comp = parseEntityKey("c:R1");
    expect(comp && isComponentKey(comp)).toBe(true);
    expect(comp && isConnectorKey(comp)).toBe(false);

    const edge = parseEntityKey("edge:e0");
    expect(edge && isEdgeKey(edge)).toBe(true);
  });
});
