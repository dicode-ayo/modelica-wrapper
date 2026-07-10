import { describe, expect, it, vi } from "vitest";
import type { DiagramLayout, PortDef, Value } from "@dicode/omc-client";

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

const {
  candidateCoversPorts,
  connectedPortsOf,
  declaredComponentsOf,
  filterCompatibleCandidates,
  resolveCandidatePorts,
} = await import("./change-class-filter.js");
const { SearchAbortedError } = await import("./library-source.js");

const REAL_INPUT = "Modelica.Blocks.Interfaces.RealInput";
const REAL_OUTPUT = "Modelica.Blocks.Interfaces.RealOutput";
const GAIN = "Modelica.Blocks.Math.Gain";

function makePort(overrides: Partial<PortDef> = {}): PortDef {
  return {
    name: "u",
    typeName: REAL_INPUT,
    placement: {
      extent: [
        [-110, -10],
        [-90, 10],
      ],
    },
    iconLayers: [],
    from: "Gain",
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
      [GAIN]: {
        name: GAIN,
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

// ── `getElements` payload builders ────────────────────────────────────

const str = (value: string): Value => ({ kind: "string", value });
const ident = (name: string): Value => ({ kind: "ident", name });
const list = (...items: Value[]): Value => ({ kind: "list", items });

/** A `"co"` row as OMC lays it out: kind, _, type, name, comment, visibility. */
function componentRow(
  typeName: string,
  name: string,
  visibility: "public" | "protected" = "public",
): Value {
  return list(
    str("co"),
    str("-"),
    ident(typeName),
    ident(name),
    str(""),
    str(visibility),
  );
}

interface FakeClass {
  components?: Array<[typeName: string, name: string]>;
  bases?: string[];
  fails?: boolean;
}

function fakeClient(classes: Record<string, FakeClass>) {
  const calls: string[] = [];
  return {
    calls,
    getElements(input: { typeName: string }): Promise<{ elements: Value }> {
      calls.push(`getElements(${input.typeName})`);
      const cls = classes[input.typeName];
      if (!cls) return Promise.reject(new Error("class not found"));
      if (cls.fails) return Promise.reject(new Error("boom"));
      return Promise.resolve({
        elements: list(
          ...(cls.components ?? []).map(([t, n]) => componentRow(t, n)),
        ),
      });
    },
    getInheritedClasses(input: {
      typeName: string;
    }): Promise<{ inheritedClasses: string[] }> {
      calls.push(`getInheritedClasses(${input.typeName})`);
      return Promise.resolve({
        inheritedClasses: classes[input.typeName]?.bases ?? [],
      });
    },
  };
}

/** `Resistor → OnePort → TwoPin` — `p`/`n` are three levels up. */
const ELECTRICAL = {
  "Modelica.Electrical.Analog.Basic.Resistor": {
    components: [["Modelica.Units.SI.Resistance", "R"]] as Array<
      [string, string]
    >,
    bases: ["Modelica.Electrical.Analog.Interfaces.OnePort"],
  },
  "Modelica.Electrical.Analog.Interfaces.OnePort": {
    components: [["Modelica.Units.SI.Current", "i"]] as Array<[string, string]>,
    bases: ["Modelica.Electrical.Analog.Interfaces.TwoPin"],
  },
  "Modelica.Electrical.Analog.Interfaces.TwoPin": {
    components: [
      ["Modelica.Electrical.Analog.Interfaces.PositivePin", "p"],
      ["Modelica.Electrical.Analog.Interfaces.NegativePin", "n"],
    ] as Array<[string, string]>,
  },
} satisfies Record<string, FakeClass>;

describe("connectedPortsOf", () => {
  it("returns [] when the component has no connections", () => {
    const layout = layoutWithConnections([], { u: makePort() });
    expect(connectedPortsOf(layout, GAIN, "gain1")).toEqual([]);
  });

  it("collects every port the component has wired up, on either side of the connection", () => {
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
        u: makePort({ name: "u" }),
        y: makePort({ name: "y", typeName: REAL_OUTPUT }),
      },
    );
    expect(connectedPortsOf(layout, GAIN, "gain1")).toEqual(
      expect.arrayContaining([
        { name: "u", typeName: REAL_INPUT },
        { name: "y", typeName: REAL_OUTPUT },
      ]),
    );
    expect(connectedPortsOf(layout, GAIN, "gain1")).toHaveLength(2);
  });

  it("ignores connections belonging to other components", () => {
    const layout = layoutWithConnections(
      [
        {
          lhs: { component: "other1", port: "u" },
          rhs: { component: "other2", port: "y" },
          waypoints: [],
        },
      ],
      { u: makePort() },
    );
    expect(connectedPortsOf(layout, GAIN, "gain1")).toEqual([]);
  });

  it("skips a connected port name that isn't in the class's connector map", () => {
    const layout = layoutWithConnections(
      [
        {
          lhs: { component: "gain1", port: "ghost" },
          rhs: { component: "src1", port: "y" },
          waypoints: [],
        },
      ],
      { u: makePort() },
    );
    expect(connectedPortsOf(layout, GAIN, "gain1")).toEqual([]);
  });
});

describe("candidateCoversPorts", () => {
  const required = [
    { name: "u", typeName: REAL_INPUT },
    { name: "y", typeName: REAL_OUTPUT },
  ];

  it("is trivially true when nothing is required", () => {
    expect(candidateCoversPorts(new Map(), [])).toBe(true);
  });

  it("is true when the candidate exposes a matching port for each requirement", () => {
    const ports = new Map([
      ["u", REAL_INPUT],
      ["y", REAL_OUTPUT],
      ["extra", REAL_INPUT],
    ]);
    expect(candidateCoversPorts(ports, required)).toBe(true);
  });

  it("is false when the candidate is missing the port entirely", () => {
    expect(candidateCoversPorts(new Map([["u", REAL_INPUT]]), required)).toBe(
      false,
    );
  });

  it("is false when the port name matches but the connector type differs", () => {
    const ports = new Map([
      ["u", REAL_INPUT],
      ["y", "Modelica.Blocks.Interfaces.IntegerOutput"],
    ]);
    expect(candidateCoversPorts(ports, required)).toBe(false);
  });

  it("rejects a swapped causality, which the connector type encodes", () => {
    const ports = new Map([
      ["u", REAL_OUTPUT],
      ["y", REAL_INPUT],
    ]);
    expect(candidateCoversPorts(ports, required)).toBe(false);
  });
});

describe("declaredComponentsOf", () => {
  it("collects public component rows by name", () => {
    const elements = list(
      componentRow("Real", "k"),
      componentRow(REAL_INPUT, "u"),
    );
    expect(declaredComponentsOf(elements)).toEqual(
      new Map([
        ["k", "Real"],
        ["u", REAL_INPUT],
      ]),
    );
  });

  it("drops protected components, which an enclosing connect() can't reference", () => {
    const elements = list(
      componentRow(REAL_INPUT, "u"),
      componentRow(
        "Modelica.Electrical.Analog.Interfaces.Pin",
        "n1",
        "protected",
      ),
    );
    expect(declaredComponentsOf(elements)).toEqual(
      new Map([["u", REAL_INPUT]]),
    );
  });

  it("skips rows that aren't components and rows with a malformed shape", () => {
    const elements = list(
      list(
        str("ex"),
        str("-"),
        ident("Base"),
        ident("b"),
        str(""),
        str("public"),
      ),
      list(
        str("co"),
        str("-"),
        str("not-an-ident"),
        ident("x"),
        str(""),
        str("public"),
      ),
      list(str("co")),
      str("junk"),
      componentRow(REAL_INPUT, "u"),
    );
    expect(declaredComponentsOf(elements)).toEqual(
      new Map([["u", REAL_INPUT]]),
    );
  });

  it("returns an empty map for a non-list payload", () => {
    expect(declaredComponentsOf(str("nope"))).toEqual(new Map());
  });
});

describe("resolveCandidatePorts", () => {
  it("walks the extends chain, which getElements does not report", async () => {
    const client = fakeClient(ELECTRICAL);
    const ports = await resolveCandidatePorts(
      client,
      "Modelica.Electrical.Analog.Basic.Resistor",
      new Map(),
    );
    expect(ports?.get("p")).toBe(
      "Modelica.Electrical.Analog.Interfaces.PositivePin",
    );
    expect(ports?.get("n")).toBe(
      "Modelica.Electrical.Analog.Interfaces.NegativePin",
    );
    expect(ports?.get("R")).toBe("Modelica.Units.SI.Resistance");
  });

  it("lets a local declaration shadow the inherited one of the same name", async () => {
    const client = fakeClient({
      Derived: { components: [["Local", "x"]], bases: ["Base"] },
      Base: { components: [["Inherited", "x"]] },
    });
    const ports = await resolveCandidatePorts(client, "Derived", new Map());
    expect(ports?.get("x")).toBe("Local");
  });

  it("reuses a cached base across candidates instead of re-walking it", async () => {
    const client = fakeClient({
      ...ELECTRICAL,
      "Modelica.Electrical.Analog.Basic.Capacitor": {
        components: [["Modelica.Units.SI.Capacitance", "C"]],
        bases: ["Modelica.Electrical.Analog.Interfaces.OnePort"],
      },
    });
    const cache = new Map();
    await resolveCandidatePorts(
      client,
      "Modelica.Electrical.Analog.Basic.Resistor",
      cache,
    );
    const before = client.calls.length;
    const ports = await resolveCandidatePorts(
      client,
      "Modelica.Electrical.Analog.Basic.Capacitor",
      cache,
    );
    expect(ports?.get("p")).toBe(
      "Modelica.Electrical.Analog.Interfaces.PositivePin",
    );
    // Only the Capacitor itself is fetched; OnePort and TwoPin are cached.
    expect(client.calls.slice(before)).toEqual([
      "getElements(Modelica.Electrical.Analog.Basic.Capacitor)",
      "getInheritedClasses(Modelica.Electrical.Analog.Basic.Capacitor)",
    ]);
  });

  it("returns undefined (fail-open) when a class fails to resolve", async () => {
    const client = fakeClient({ Broken: { fails: true } });
    expect(
      await resolveCandidatePorts(client, "Broken", new Map()),
    ).toBeUndefined();
  });

  it("fails open when an inherited base fails to resolve", async () => {
    const client = fakeClient({
      Derived: { components: [["Real", "k"]], bases: ["Broken"] },
      Broken: { fails: true },
    });
    expect(
      await resolveCandidatePorts(client, "Derived", new Map()),
    ).toBeUndefined();
  });

  it("terminates on a cyclic extends chain", async () => {
    const client = fakeClient({
      A: { components: [["Real", "a"]], bases: ["B"] },
      B: { components: [["Real", "b"]], bases: ["A"] },
    });
    const ports = await resolveCandidatePorts(client, "A", new Map());
    expect(ports?.get("a")).toBe("Real");
    expect(ports?.get("b")).toBe("Real");
  });

  it("does not cache a failure, so a later attempt can succeed", async () => {
    let broken = true;
    const client = {
      getElements(_input: { typeName: string }): Promise<{ elements: Value }> {
        if (broken) return Promise.reject(new Error("boom"));
        return Promise.resolve({ elements: list(componentRow("Real", "k")) });
      },
      getInheritedClasses(): Promise<{ inheritedClasses: string[] }> {
        return Promise.resolve({ inheritedClasses: [] });
      },
    };
    const cache = new Map();
    expect(await resolveCandidatePorts(client, "Later", cache)).toBeUndefined();
    broken = false;
    const ports = await resolveCandidatePorts(client, "Later", cache);
    expect(ports?.get("k")).toBe("Real");
  });

  it("throws SearchAbortedError rather than failing open when aborted", async () => {
    const client = fakeClient(ELECTRICAL);
    const controller = new AbortController();
    controller.abort();
    await expect(
      resolveCandidatePorts(
        client,
        "Modelica.Electrical.Analog.Basic.Resistor",
        new Map(),
        controller.signal,
      ),
    ).rejects.toBeInstanceOf(SearchAbortedError);
  });
});

describe("filterCompatibleCandidates", () => {
  const required = [
    { name: "u", typeName: REAL_INPUT },
    { name: "y", typeName: REAL_OUTPUT },
  ];
  const blocks = {
    Compatible: {
      components: [
        [REAL_INPUT, "u"],
        [REAL_OUTPUT, "y"],
      ],
    },
    Incompatible: { components: [[REAL_INPUT, "u"]] },
    Broken: { fails: true },
  } satisfies Record<string, FakeClass>;

  it("skips OMC entirely and returns candidates unchanged when nothing is required", async () => {
    const client = fakeClient(blocks);
    const candidates = [{ qualified: "Incompatible" }];
    expect(
      await filterCompatibleCandidates(client, candidates, [], new Map()),
    ).toEqual(candidates);
    expect(client.calls).toEqual([]);
  });

  it("keeps only candidates whose ports cover the required ones", async () => {
    const client = fakeClient(blocks);
    const result = await filterCompatibleCandidates(
      client,
      [{ qualified: "Compatible" }, { qualified: "Incompatible" }],
      required,
      new Map(),
    );
    expect(result).toEqual([{ qualified: "Compatible" }]);
  });

  it("keeps a candidate whose resolution fails (fail-open)", async () => {
    const client = fakeClient(blocks);
    const result = await filterCompatibleCandidates(
      client,
      [{ qualified: "Broken" }],
      required,
      new Map(),
    );
    expect(result).toEqual([{ qualified: "Broken" }]);
  });

  it("reuses the cache across calls instead of re-resolving", async () => {
    const client = fakeClient(blocks);
    const cache = new Map();
    const candidates = [{ qualified: "Compatible" }];
    await filterCompatibleCandidates(client, candidates, required, cache);
    const before = client.calls.length;
    await filterCompatibleCandidates(client, candidates, required, cache);
    expect(client.calls.length).toBe(before);
  });

  it("drops the queued remainder once the signal aborts", async () => {
    const client = fakeClient(blocks);
    const controller = new AbortController();
    controller.abort();
    await expect(
      filterCompatibleCandidates(
        client,
        [{ qualified: "Compatible" }, { qualified: "Incompatible" }],
        required,
        new Map(),
        controller.signal,
      ),
    ).rejects.toBeInstanceOf(SearchAbortedError);
    expect(client.calls).toEqual([]);
  });
});
