/**
 * `fetchIconLayout` resolves an icon from the cheap filtered annotation call and
 * only instantiates the class when that call fails to answer at all. A class
 * that merely has no Icon must not be instantiated: OMC never returns for the
 * builtins, and a deep hierarchy costs seconds on a channel every other call
 * shares.
 *
 * `open-diagram.ts` imports `vscode`; the extension's vitest config aliases
 * it to a mock, so this runs in plain Node.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DiagramLayout,
  ModelInstance,
  OmcClient,
  RectangleShape,
} from "@dicode/omc-client";

import { executedCommands } from "../../test-support/vscode-mock.js";
import {
  applyDiagramEdits,
  fetchIconLayout,
  guardAddComponent,
  libraryIconSvg,
  openDiagram,
  type PartialCheckClient,
} from "./open-diagram.js";

describe("openDiagram", () => {
  beforeEach(() => {
    executedCommands.length = 0;
  });

  it("opens the class in the modelica.diagram custom editor via openWith", async () => {
    await openDiagram("Modelica.Blocks.Math.Gain");
    const call = executedCommands.find((c) => c.command === "vscode.openWith");
    expect(call).toBeDefined();
    expect(String(call?.args[0])).toBe(
      "modelica-source:/Modelica.Blocks.Math.Gain.mo",
    );
    expect(call?.args[1]).toBe("modelica.diagram");
  });

  it("does nothing when no class is resolved", async () => {
    await openDiagram(undefined);
    expect(executedCommands.some((c) => c.command === "vscode.openWith")).toBe(
      false,
    );
  });
});

/**
 * A minimal instance with a usable Icon annotation. Empty `graphics` but a
 * `coordinateSystem` is enough for the producer to emit an icon layer (a
 * layer is created when graphics OR a coord system is present), so the
 * fixture stays free of hand-crafted record-shape encodings.
 */
const WITH_ICON: ModelInstance = {
  name: "Pkg.HasIcon",
  restriction: "model",
  annotation: {
    Icon: {
      coordinateSystem: {
        extent: [
          [-100, -100],
          [100, 100],
        ],
      },
      graphics: [],
    },
  },
};

/** An instance whose annotation is null — valid JSON, no Icon to paint. */
const NULL_ANNOTATION: ModelInstance = {
  name: "Pkg.NullAnno",
  restriction: "model",
  annotation: null,
};

function makeClient(handlers: {
  annotation?: () => Promise<{ instance: ModelInstance }>;
  full?: () => Promise<{ instance: ModelInstance }>;
}): { client: OmcClient; calls: string[] } {
  const calls: string[] = [];
  const invoke = vi.fn(async (fn: string) => {
    calls.push(fn);
    if (fn === "getModelInstanceAnnotation") {
      return (
        handlers.annotation?.() ?? Promise.resolve({ instance: WITH_ICON })
      );
    }
    if (fn === "getModelInstance") {
      return handlers.full?.() ?? Promise.resolve({ instance: WITH_ICON });
    }
    throw new Error(`unexpected invoke: ${fn}`);
  });
  const client = { invoke } as unknown as OmcClient;
  return { client, calls };
}

describe("fetchIconLayout: when the annotation path is trusted", () => {
  it("uses the cheap annotation path when it returns a usable Icon", async () => {
    const { client, calls } = makeClient({
      annotation: async () => ({ instance: WITH_ICON }),
    });
    const layout = await fetchIconLayout(client, "Pkg.HasIcon");
    expect(calls).toEqual(["getModelInstanceAnnotation"]);
    expect(layout.kind).toBe("icon");
    expect(layout.iconLayers.length).toBeGreaterThan(0);
  });

  it("does not instantiate a class whose annotation carries no Icon", async () => {
    const { client, calls } = makeClient({
      annotation: async () => ({ instance: NULL_ANNOTATION }),
      full: async () => ({ instance: WITH_ICON }),
    });
    const layout = await fetchIconLayout(client, "Pkg.NullAnno");
    // Instantiating here is what hangs OMC on `String` and costs seconds on
    // deep models, to rediscover there is nothing to paint.
    expect(calls).toEqual(["getModelInstanceAnnotation"]);
    expect(layout.iconLayers).toHaveLength(0);
  });

  // An empty OMC reply throws in `JSON.parse` and a malformed one fails the
  // schema, so throwing is the only way the cheap call fails to answer.
  it("falls back to getModelInstance when the annotation call throws", async () => {
    const { client, calls } = makeClient({
      annotation: async () => {
        throw new Error("filtered call failed");
      },
      full: async () => ({ instance: WITH_ICON }),
    });
    const layout = await fetchIconLayout(client, "Pkg.Broken");
    expect(calls).toEqual(["getModelInstanceAnnotation", "getModelInstance"]);
    expect(layout.iconLayers.length).toBeGreaterThan(0);
  });

  it("counts an Icon inherited from an extends ancestor as usable (no fallback)", async () => {
    const inherited: ModelInstance = {
      name: "Pkg.Derived",
      restriction: "model",
      annotation: null,
      elements: [{ $kind: "extends", baseClass: WITH_ICON }],
    };
    const { client, calls } = makeClient({
      annotation: async () => ({ instance: inherited }),
    });
    const layout = await fetchIconLayout(client, "Pkg.Derived");
    expect(calls).toEqual(["getModelInstanceAnnotation"]);
    // Deleting the instantiating fallback must not cost us inherited icons.
    expect(layout.iconLayers.length).toBeGreaterThan(0);
  });
});

describe("libraryIconSvg: dependency reporting", () => {
  it("reports the extends chain as the icon's dependencies", async () => {
    const derived: ModelInstance = {
      name: "Pkg.Derived",
      restriction: "model",
      annotation: null,
      elements: [{ $kind: "extends", baseClass: WITH_ICON }],
    };
    const { client } = makeClient({
      annotation: async () => ({ instance: derived }),
    });
    const { svg, dependsOn } = await libraryIconSvg(client, "Pkg.Derived");
    expect(svg).toBeDefined();
    expect(dependsOn).toEqual(["Pkg.HasIcon"]);
  });

  it("reports no dependencies for a class with no extends chain", async () => {
    const { client } = makeClient({
      annotation: async () => ({ instance: WITH_ICON }),
    });
    const { dependsOn } = await libraryIconSvg(client, "Pkg.HasIcon");
    expect(dependsOn).toEqual([]);
  });

  it("reports dependencies as undefined when the instance can't be fetched", async () => {
    const { client } = makeClient({
      annotation: async () => {
        throw new Error("filtered call failed");
      },
      full: async () => {
        throw new Error("instantiation failed");
      },
    });
    const { svg, dependsOn } = await libraryIconSvg(client, "Pkg.Broken");
    expect(svg).toBeUndefined();
    // Undefined, not `[]`: the chain is unknown, so the caller keeps its edges.
    expect(dependsOn).toBeUndefined();
  });
});

describe("guardAddComponent", () => {
  it("proceeds for a non-partial class", async () => {
    const client: PartialCheckClient = {
      isPartial: async () => ({ b: false }),
    };
    const result = await guardAddComponent(client, "Pkg.ConcreteModel");
    expect(result).toEqual({ kind: "proceed" });
  });

  it("blocks a partial class with a warning-worthy message", async () => {
    const client: PartialCheckClient = { isPartial: async () => ({ b: true }) };
    const result = await guardAddComponent(client, "Pkg.PartialModel");
    expect(result).toEqual({
      kind: "blocked",
      message:
        "Pkg.PartialModel is a partial class and cannot be placed as a component.",
    });
  });

  it("turns a failing isPartial call into a guard-failed result instead of throwing", async () => {
    const client: PartialCheckClient = {
      isPartial: async () => {
        throw new Error("OMC socket timeout");
      },
    };
    const result = await guardAddComponent(client, "Pkg.Unknown");
    expect(result).toEqual({
      kind: "guard-failed",
      message: "isPartial Pkg.Unknown failed: OMC socket timeout",
    });
  });
});

/** A client whose `invoke` records the calls it received and reports success
 *  for all of them; `listFile` reports empty so `captureSnapshot` (issue #29's
 *  snapshot/rollback machinery) opts itself out rather than needing a full
 *  source-text fixture this test doesn't otherwise care about. */
function stubEditClient(): { client: OmcClient; invoked: string[] } {
  const invoked: string[] = [];
  const client = {
    invoke: vi.fn(async (fn: string) => {
      invoked.push(fn);
      return { success: true };
    }),
    listFile: vi.fn(async () => ({ contents: "" })),
    get lastCall() {
      return "stub(...)";
    },
  } as unknown as OmcClient;
  return { client, invoked };
}

function connectedLayout(): DiagramLayout {
  return {
    kind: "diagram",
    className: "Pkg.M",
    source: { file: "Pkg/M.mo", line: 1, column: 1 } as never,
    iconLayers: [],
    diagramLayers: [],
    labels: [],
    classes: {},
    components: {
      gain1: {
        name: "gain1",
        classRef: "Modelica.Blocks.Math.Gain",
        placement: {
          extent: [
            [10, 10],
            [30, 30],
          ],
        },
      },
      gain2: {
        name: "gain2",
        classRef: "Modelica.Blocks.Math.Gain",
        placement: {
          extent: [
            [50, 50],
            [70, 70],
          ],
        },
      },
    },
    connectors: {},
    connections: [
      {
        lhs: { component: "gain1", port: "y" },
        rhs: { component: "gain2", port: "u" },
        waypoints: [],
      },
    ],
  };
}

/** `components.gain1`, guarded rather than indexed straight past the
 *  `Record<string, ComponentInstance | undefined>` check. */
function requireGain1(
  layout: DiagramLayout,
): NonNullable<DiagramLayout["components"][string]> {
  const gain1 = layout.components.gain1;
  if (gain1 === undefined) throw new Error("fixture is missing gain1");
  return gain1;
}

describe("applyDiagramEdits: staleBase (issue #408)", () => {
  it("does not delete a component or connection the report never knew about, but still moves the one it reported", async () => {
    const { client, invoked } = stubEditClient();
    const current = connectedLayout();
    const next = connectedLayout();
    // gain1 moved; gain2 and its connection to gain1 are simply absent —
    // exactly what a stale-base report looks like, per issue #408.
    next.components = {
      gain1: {
        ...requireGain1(current),
        placement: {
          extent: [
            [20, 20],
            [40, 40],
          ],
        },
      },
    };
    next.connections = [];

    const result = await applyDiagramEdits(client, "Pkg.M", current, next, {
      staleBase: true,
    });

    expect(result).not.toBeNull();
    expect(invoked).toContain("updateComponent");
    expect(invoked).not.toContain("deleteComponent");
    expect(invoked).not.toContain("deleteConnection");
  });

  it("still deletes a component and connection the user actually removed when staleBase is unset", async () => {
    const { client, invoked } = stubEditClient();
    const current = connectedLayout();
    const next = connectedLayout();
    next.components = { gain1: requireGain1(current) };
    next.connections = [];

    await applyDiagramEdits(client, "Pkg.M", current, next);

    expect(invoked).toContain("deleteComponent");
    expect(invoked).toContain("deleteConnection");
  });
});

describe("applyDiagramEdits: staleBase graphics (issue #408)", () => {
  function rect(x: number): RectangleShape {
    return {
      kind: "rectangle",
      extent: [
        [x, x],
        [x + 10, x + 10],
      ],
    };
  }

  function withDiagramShapes(shapes: RectangleShape[]): DiagramLayout {
    const layout = connectedLayout();
    layout.diagramLayers = [{ from: "Pkg.M", shapes }];
    return layout;
  }

  it("drops every graphics edit on a stale base, not just graphicsDeleted, when the shape count shrinks", async () => {
    // A stale report never learned about a shape OMC already holds
    // (`rect(90)` here). `diffGraphics` reads positionally, so the unknown
    // shape doesn't go missing at the tail — it shifts every later index and
    // turns into an in-place overwrite (`graphicsModified`) of a neighbor,
    // not a clean `graphicsDeleted` that filtering only that kind would catch.
    const { client, invoked } = stubEditClient();
    const current = withDiagramShapes([rect(90), rect(10), rect(20)]);
    const next = withDiagramShapes([rect(11), rect(20)]);

    await applyDiagramEdits(client, "Pkg.M", current, next, {
      staleBase: true,
    });

    expect(invoked).not.toContain("writeClassGraphics");
  });

  it("drops every graphics edit on a stale base even when the shape count grows, where there is no delete at all to filter", async () => {
    const { client, invoked } = stubEditClient();
    const current = withDiagramShapes([rect(90), rect(10), rect(20)]);
    const next = withDiagramShapes([rect(10), rect(20), rect(30), rect(40)]);

    await applyDiagramEdits(client, "Pkg.M", current, next, {
      staleBase: true,
    });

    expect(invoked).not.toContain("writeClassGraphics");
  });

  it("still applies graphics edits when staleBase is unset", async () => {
    const { client, invoked } = stubEditClient();
    const current = withDiagramShapes([rect(90), rect(10), rect(20)]);
    const next = withDiagramShapes([rect(11), rect(20)]);

    await applyDiagramEdits(client, "Pkg.M", current, next);

    expect(invoked).toContain("writeClassGraphics");
  });
});

describe("applyDiagramEdits: staleBase connectionRenamed (issue #408)", () => {
  function withConnections(
    connections: DiagramLayout["connections"],
  ): DiagramLayout {
    const layout = connectedLayout();
    layout.connections = connections;
    return layout;
  }

  it("drops a connectionRenamed that pairs an unknown connection with a freshly drawn one, rather than rewriting it in place", async () => {
    // `pins[3].p -> ground.p` is OMC's real state; the stale report never
    // learned about it. The report instead draws a NEW connection at a
    // different subscript of the same vector, `pins[2].p -> ground.p` — same
    // waypoints/style, one endpoint's base matching, only the index differing.
    // That is exactly the shape `isReindexRename` treats as a lone
    // `connectorSizing` re-index (issue #26), so left unguarded it would
    // rewrite the unknown connection's endpoints onto the drawn one instead
    // of leaving both alone.
    const { client, invoked } = stubEditClient();
    const current = withConnections([
      {
        lhs: { component: "pins", port: "p", componentSubscripts: "[3]" },
        rhs: { component: "ground", port: "p" },
        waypoints: [],
      },
    ]);
    const next = withConnections([
      {
        lhs: { component: "pins", port: "p", componentSubscripts: "[2]" },
        rhs: { component: "ground", port: "p" },
        waypoints: [],
      },
    ]);

    await applyDiagramEdits(client, "Pkg.M", current, next, {
      staleBase: true,
    });

    expect(invoked).not.toContain("updateConnectionNames");
  });

  it("still applies a connectionRenamed when staleBase is unset", async () => {
    const { client, invoked } = stubEditClient();
    const current = withConnections([
      {
        lhs: { component: "pins", port: "p", componentSubscripts: "[3]" },
        rhs: { component: "ground", port: "p" },
        waypoints: [],
      },
    ]);
    const next = withConnections([
      {
        lhs: { component: "pins", port: "p", componentSubscripts: "[2]" },
        rhs: { component: "ground", port: "p" },
        waypoints: [],
      },
    ]);

    await applyDiagramEdits(client, "Pkg.M", current, next);

    expect(invoked).toContain("updateConnectionNames");
  });
});
