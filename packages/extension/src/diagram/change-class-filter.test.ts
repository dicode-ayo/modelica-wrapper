import { describe, expect, it, vi } from "vitest";
import type { DiagramLayout, ModelInstance, PortDef } from "@dicode/omc-client";

vi.mock("../logger.js", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  },
}));

vi.mock("@dicode/omc-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dicode/omc-client")>();
  return {
    ...actual,
    diagram: {
      ...actual.diagram,
      produceDiagramLayout: vi.fn(),
    },
  };
});

const { diagram } = await import("@dicode/omc-client");
const {
  candidateCoversPorts,
  connectedPortsOf,
  fetchCandidateConnectors,
  filterCompatibleCandidates,
} = await import("./change-class-filter.js");

function makePort(overrides: Partial<PortDef> = {}): PortDef {
  return {
    name: "u",
    typeName: "Modelica.Blocks.Interfaces.RealInput",
    placement: {
      extent: [
        [-110, -10],
        [-90, 10],
      ],
    },
    iconLayers: [],
    from: "Gain",
    direction: "input",
    ...overrides,
  };
}

function layoutWithConnections(
  connections: DiagramLayout["connections"],
  gainConnectors: Record<string, PortDef>,
): DiagramLayout {
  return {
    kind: "diagram",
    className: "Sample",
    source: {
      filename: "sample.mo",
      lineStart: 1,
      columnStart: 1,
      lineEnd: 1,
      columnEnd: 1,
    },
    iconLayers: [],
    diagramLayers: [],
    labels: [],
    classes: {
      "Modelica.Blocks.Math.Gain": {
        name: "Modelica.Blocks.Math.Gain",
        restriction: "block",
        iconLayers: [],
        connectors: gainConnectors,
        parameters: {},
      },
    },
    components: {},
    connectors: {},
    connections,
  };
}

describe("connectedPortsOf", () => {
  it("returns [] when the component has no connections", () => {
    const layout = layoutWithConnections([], {
      u: makePort({ name: "u", direction: "input" }),
    });
    expect(
      connectedPortsOf(layout, "Modelica.Blocks.Math.Gain", "gain1"),
    ).toEqual([]);
  });

  it("collects the profile of every port the component has wired up, on either side of the connection", () => {
    const layout = layoutWithConnections(
      [
        {
          lhs: { component: "gain1", port: "u" },
          rhs: { component: "src1", port: "y" },
          waypoints: [],
        },
        {
          lhs: { component: "sink1", port: "u" },
          rhs: { component: "gain1", port: "y" },
          waypoints: [],
        },
      ],
      {
        u: makePort({ name: "u", direction: "input" }),
        y: makePort({
          name: "y",
          typeName: "Modelica.Blocks.Interfaces.RealOutput",
          direction: "output",
        }),
      },
    );
    const profile = connectedPortsOf(
      layout,
      "Modelica.Blocks.Math.Gain",
      "gain1",
    );
    expect(profile.map((p) => p.name).sort()).toEqual(["u", "y"]);
  });

  it("ignores connections belonging to other components", () => {
    const layout = layoutWithConnections(
      [
        {
          lhs: { component: "gain2", port: "u" },
          rhs: { component: "src1", port: "y" },
          waypoints: [],
        },
      ],
      { u: makePort({ name: "u" }) },
    );
    expect(
      connectedPortsOf(layout, "Modelica.Blocks.Math.Gain", "gain1"),
    ).toEqual([]);
  });

  it("skips a connected port name that isn't in the class's own connector map", () => {
    const layout = layoutWithConnections(
      [
        {
          lhs: { component: "gain1", port: "unknownPort" },
          rhs: { component: "src1", port: "y" },
          waypoints: [],
        },
      ],
      { u: makePort({ name: "u" }) },
    );
    expect(
      connectedPortsOf(layout, "Modelica.Blocks.Math.Gain", "gain1"),
    ).toEqual([]);
  });
});

describe("candidateCoversPorts", () => {
  const required = [
    {
      name: "u",
      typeName: "Modelica.Blocks.Interfaces.RealInput",
      direction: "input" as const,
      flow: undefined,
      stream: undefined,
    },
  ];

  it("is trivially true when nothing is required", () => {
    expect(candidateCoversPorts({}, [])).toBe(true);
  });

  it("is true when the candidate has a matching port (name + type + causality)", () => {
    expect(
      candidateCoversPorts(
        { u: makePort({ name: "u", direction: "input" }) },
        required,
      ),
    ).toBe(true);
  });

  it("is false when the candidate is missing the port entirely", () => {
    expect(candidateCoversPorts({}, required)).toBe(false);
  });

  it("is false when the port name matches but the connector type differs", () => {
    expect(
      candidateCoversPorts(
        {
          u: makePort({
            name: "u",
            typeName: "Modelica.Blocks.Interfaces.BooleanInput",
            direction: "input",
          }),
        },
        required,
      ),
    ).toBe(false);
  });

  it("is false when the port name and type match but causality differs", () => {
    expect(
      candidateCoversPorts(
        { u: makePort({ name: "u", direction: "output" }) },
        required,
      ),
    ).toBe(false);
  });

  it("is false when flow/stream prefixes differ", () => {
    const flowRequired = [
      {
        name: "p",
        typeName: "Modelica.Electrical.Analog.Interfaces.PositivePin",
        direction: "" as const,
        flow: true,
        stream: undefined,
      },
    ];
    expect(
      candidateCoversPorts(
        {
          p: makePort({
            name: "p",
            typeName: "Modelica.Electrical.Analog.Interfaces.PositivePin",
            direction: "",
            flow: false,
          }),
        },
        flowRequired,
      ),
    ).toBe(false);
  });
});

describe("fetchCandidateConnectors", () => {
  it("returns the candidate's own connector map on success", async () => {
    const instance = {
      name: "Modelica.Blocks.Math.Abs",
      restriction: "block",
      elements: [],
    } as unknown as ModelInstance;
    const client = {
      invoke: vi.fn().mockResolvedValue({ instance }),
    };
    const connectors = { u: makePort({ name: "u" }) };
    vi.mocked(diagram.produceDiagramLayout).mockReturnValueOnce({
      ...layoutWithConnections([], {}),
      classes: {
        "Modelica.Blocks.Math.Abs": {
          name: "Modelica.Blocks.Math.Abs",
          restriction: "block",
          iconLayers: [],
          connectors,
          parameters: {},
        },
      },
    });

    const result = await fetchCandidateConnectors(
      client,
      "Modelica.Blocks.Math.Abs",
    );

    expect(client.invoke).toHaveBeenCalledWith("getModelInstance", {
      typeName: "Modelica.Blocks.Math.Abs",
    });
    expect(result).toEqual(connectors);
  });

  it("returns undefined (fail-open) when the OMC call throws", async () => {
    const client = {
      invoke: vi.fn().mockRejectedValue(new Error("transport closed")),
    };
    const result = await fetchCandidateConnectors(client, "Some.Class");
    expect(result).toBeUndefined();
  });
});

describe("filterCompatibleCandidates", () => {
  const gainPort = { u: makePort({ name: "u", direction: "input" }) };
  const required = [
    {
      name: "u",
      typeName: "Modelica.Blocks.Interfaces.RealInput",
      direction: "input" as const,
      flow: undefined,
      stream: undefined,
    },
  ];

  it("skips OMC entirely and returns candidates unchanged when nothing is required", async () => {
    const client = { invoke: vi.fn() };
    const candidates = [{ qualified: "A" }, { qualified: "B" }];
    const result = await filterCompatibleCandidates(
      client,
      candidates,
      [],
      new Map(),
    );
    expect(result).toEqual(candidates);
    expect(client.invoke).not.toHaveBeenCalled();
  });

  it("keeps only candidates whose fetched connectors cover the required ports", async () => {
    const invoke = vi.fn((_method: string, input: { typeName: string }) => {
      if (input.typeName === "Compatible") {
        return Promise.resolve({
          instance: { name: "Compatible" } as unknown as ModelInstance,
        });
      }
      return Promise.resolve({
        instance: { name: "Incompatible" } as unknown as ModelInstance,
      });
    });
    const client = { invoke };
    vi.mocked(diagram.produceDiagramLayout).mockImplementation(
      (mi) =>
        ({
          ...layoutWithConnections([], {}),
          classes: {
            [mi.name]: {
              name: mi.name,
              restriction: "block",
              iconLayers: [],
              connectors: mi.name === "Compatible" ? gainPort : {},
              parameters: {},
            },
          },
        }) as unknown as DiagramLayout,
    );

    const candidates = [
      { qualified: "Compatible" },
      { qualified: "Incompatible" },
    ];
    const result = await filterCompatibleCandidates(
      client,
      candidates,
      required,
      new Map(),
    );
    expect(result).toEqual([{ qualified: "Compatible" }]);
  });

  it("keeps a candidate whose connector fetch fails (fail-open)", async () => {
    const client = { invoke: vi.fn().mockRejectedValue(new Error("boom")) };
    const candidates = [{ qualified: "Flaky" }];
    const result = await filterCompatibleCandidates(
      client,
      candidates,
      required,
      new Map(),
    );
    expect(result).toEqual(candidates);
  });

  it("caches a candidate's connectors across calls instead of re-fetching", async () => {
    const invoke = vi.fn().mockResolvedValue({
      instance: { name: "Compatible" } as unknown as ModelInstance,
    });
    const client = { invoke };
    vi.mocked(diagram.produceDiagramLayout).mockImplementation(
      () =>
        ({
          ...layoutWithConnections([], {}),
          classes: {
            Compatible: {
              name: "Compatible",
              restriction: "block",
              iconLayers: [],
              connectors: gainPort,
              parameters: {},
            },
          },
        }) as unknown as DiagramLayout,
    );

    const cache = new Map<string, Record<string, PortDef> | undefined>();
    const candidates = [{ qualified: "Compatible" }];
    await filterCompatibleCandidates(client, candidates, required, cache);
    await filterCompatibleCandidates(client, candidates, required, cache);

    expect(invoke).toHaveBeenCalledOnce();
  });
});
