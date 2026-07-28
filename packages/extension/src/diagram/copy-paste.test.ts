import { describe, expect, it } from "vitest";

import type { DiagramLayout, RectangleShape } from "@dicode/omc-client";

import {
  DiagramClipboard,
  PASTE_OFFSET,
  type ClipboardComponent,
  type ClipboardConnection,
  type ClipboardEntry,
} from "./clipboard.js";
import {
  captureClipboardItems,
  pastedSelectionKeys,
  pasteClipboardItems,
  uniquePasteName,
  type CopyClient,
  type PasteClient,
} from "./copy-paste.js";

const rect: RectangleShape = {
  kind: "rectangle",
  extent: [
    [-10, -10],
    [10, 10],
  ],
  fillColor: [255, 0, 0],
};

function layout(): DiagramLayout {
  return {
    kind: "diagram",
    className: "Demo",
    source: {
      filename: "demo.mo",
      lineStart: 1,
      columnStart: 1,
      lineEnd: 1,
      columnEnd: 1,
    },
    iconLayers: [],
    diagramLayers: [{ from: "Demo", shapes: [rect] }],
    labels: [],
    classes: {},
    components: {
      gain1: {
        name: "gain1",
        classRef: "Modelica.Blocks.Math.Gain",
        placement: {
          extent: [
            [0, 0],
            [20, 20],
          ],
          rotation: 90,
        },
      },
    },
    connectors: {
      u: {
        name: "u",
        classRef: "Modelica.Blocks.Interfaces.RealInput",
        placement: {
          extent: [
            [-100, -10],
            [-80, 10],
          ],
        },
      },
    },
    connections: [],
  };
}

/** Records every OMC read so a test can assert what was asked for. */
function copyClient(
  modifiers: Record<string, Record<string, string>> = {},
): CopyClient & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    getElementModifierNames: ({ elementName }) => {
      reads.push(`names:${elementName}`);
      return Promise.resolve({
        modifiers: Object.keys(modifiers[elementName] ?? {}),
      });
    },
    getElementModifierValue: ({ modifier }) => {
      reads.push(`value:${modifier}`);
      const dot = modifier.indexOf(".");
      const element = modifier.slice(0, dot);
      const path = modifier.slice(dot + 1);
      return Promise.resolve({ value: modifiers[element]?.[path] ?? "" });
    },
  };
}

/** The one call shape a paste makes. */
interface PasteCall {
  data: string;
  typeName: string;
}

/**
 * Records the single block a paste hands to OMC. `reject` turns the call into
 * an OMC rejection, which is now all-or-nothing.
 */
function pasteClient(
  reject: (data: string) => string | null = () => null,
): PasteClient & { calls: PasteCall[]; data: () => string } {
  const calls: PasteCall[] = [];
  return {
    calls,
    data: () => {
      const first = calls.at(0);
      if (first === undefined) throw new Error("no paste call was made");
      return first.data;
    },
    getErrorString: () =>
      Promise.resolve({ errorString: "OMC says: something is wrong" }),
    loadClassContentString: (arg) => {
      calls.push(arg);
      const diagnostic = reject(arg.data);
      return Promise.resolve(
        diagnostic === null
          ? { success: true }
          : { success: false, diagnostic },
      );
    },
  };
}

function componentItem(
  patch: Partial<ClipboardComponent> = {},
): ClipboardComponent {
  return {
    kind: "component",
    name: "gain1",
    className: "Modelica.Blocks.Math.Gain",
    extent: [
      [0, 0],
      [20, 20],
    ],
    rotation: 0,
    modifiers: [],
    ...patch,
  };
}

describe("captureClipboardItems", () => {
  it("captures a component with its placement and authored modifiers", async () => {
    const client = copyClient({ gain1: { k: "2.5" } });
    const items = await captureClipboardItems(client, layout(), ["c:gain1"]);
    expect(items).toEqual([
      {
        kind: "component",
        name: "gain1",
        className: "Modelica.Blocks.Math.Gain",
        extent: [
          [0, 0],
          [20, 20],
        ],
        rotation: 90,
        modifiers: [{ path: "k", expr: "2.5" }],
      },
    ]);
  });

  it("drops a modifier OMC reports with no bound expression", async () => {
    // An empty expr means "clear" to setElementModifierValue, so replaying it
    // would remove a binding the paste never set.
    const client = copyClient({ gain1: { k: "2.5", unit: "" } });
    const items = await captureClipboardItems(client, layout(), ["c:gain1"]);
    expect((items[0] as ClipboardComponent).modifiers).toEqual([
      { path: "k", expr: "2.5" },
    ]);
  });

  it("captures a standalone connector", async () => {
    const items = await captureClipboardItems(copyClient(), layout(), ["k:u"]);
    expect(items).toHaveLength(1);
    expect((items[0] as ClipboardComponent).className).toBe(
      "Modelica.Blocks.Interfaces.RealInput",
    );
  });

  it("skips a port on a sub-component — it is not a declaration of its own", async () => {
    const client = copyClient();
    expect(
      await captureClipboardItems(client, layout(), ["k:gain1.u"]),
    ).toEqual([]);
    expect(client.reads).toEqual([]);
  });

  it("keeps the copyable keys a rubber-band sweeps up alongside edges", async () => {
    const items = await captureClipboardItems(copyClient(), layout(), [
      "edge:0",
      "c:gain1",
      "junc:0/1",
      "shape:rectangle:0",
    ]);
    expect(items.map((i) => i.kind)).toEqual(["component", "shape"]);
  });

  it("captures a host shape by its positional key", async () => {
    const items = await captureClipboardItems(copyClient(), layout(), [
      "shape:rectangle:0",
    ]);
    expect(items).toEqual([{ kind: "shape", shape: rect }]);
  });

  it("skips a shape key whose kind no longer matches that index", async () => {
    const items = await captureClipboardItems(copyClient(), layout(), [
      "shape:ellipse:0",
    ]);
    expect(items).toEqual([]);
  });
});

describe("captureClipboardItems: connections", () => {
  /** `gain1 → gain2`, plus a wire out to a component that isn't copied. */
  function wired(): DiagramLayout {
    const base = layout();
    return {
      ...base,
      components: {
        ...base.components,
        gain2: {
          name: "gain2",
          classRef: "Modelica.Blocks.Math.Gain",
          placement: {
            extent: [
              [40, 0],
              [60, 20],
            ],
          },
        },
        sink: {
          name: "sink",
          classRef: "Modelica.Blocks.Interfaces.RealInput",
          placement: {
            extent: [
              [80, 0],
              [100, 20],
            ],
          },
        },
      },
      connections: [
        {
          lhs: { component: "gain1", port: "y" },
          rhs: { component: "gain2", port: "u" },
          waypoints: [
            [20, 10],
            [40, 10],
          ],
          color: [255, 0, 0],
        },
        {
          lhs: { component: "gain2", port: "y" },
          rhs: { component: "sink", port: "u" },
          waypoints: [],
        },
      ],
    };
  }

  it("carries a connection whose endpoints are both copied", async () => {
    const items = await captureClipboardItems(copyClient(), wired(), [
      "c:gain1",
      "c:gain2",
    ]);
    expect(items.filter((i) => i.kind === "connection")).toEqual([
      {
        kind: "connection",
        lhs: { component: "gain1", port: "y" },
        rhs: { component: "gain2", port: "u" },
        waypoints: [
          [20, 10],
          [40, 10],
        ],
        style: { color: [255, 0, 0] },
      },
    ]);
  });

  it("carries the wire once whether or not the edge was selected", async () => {
    // The edge key is skipped as uncopyable and the wire is then added back
    // from the component set — the two paths must not both contribute it.
    const items = await captureClipboardItems(copyClient(), wired(), [
      "c:gain1",
      "edge:0",
      "c:gain2",
    ]);
    expect(items.filter((i) => i.kind === "connection")).toHaveLength(1);
  });

  it("refuses a wire onto a subscripted component", async () => {
    // `addComponent` writes a scalar, so the pasted copy of `bus[2]` has no
    // dimensions and `bus1[1].y` would index something that isn't an array.
    // OMC accepts that cref and writes it out, so the guard has to be ours.
    const base = wired();
    const arrayed: DiagramLayout = {
      ...base,
      connections: [
        {
          lhs: { component: "gain1", port: "y", componentSubscripts: "[1]" },
          rhs: { component: "gain2", port: "u" },
          waypoints: [],
        },
      ],
    };
    const items = await captureClipboardItems(copyClient(), arrayed, [
      "c:gain1",
      "c:gain2",
    ]);
    expect(items.every((i) => i.kind !== "connection")).toBe(true);
  });

  it("carries a wire onto a standalone connector on the host class", async () => {
    // A host-class port has no `component`; its identity is the port name,
    // and it is copyable in its own right.
    const base = wired();
    const withPort: DiagramLayout = {
      ...base,
      connections: [
        {
          lhs: { component: undefined, port: "u" },
          rhs: { component: "gain1", port: "u" },
          waypoints: [],
        },
      ],
    };
    const items = await captureClipboardItems(copyClient(), withPort, [
      "k:u",
      "c:gain1",
    ]);
    expect(items.filter((i) => i.kind === "connection")).toHaveLength(1);
  });

  it("drops a connection with one endpoint outside the copy", async () => {
    const items = await captureClipboardItems(copyClient(), wired(), [
      "c:gain2",
      "c:sink",
    ]);
    // `gain2 → sink` is inside this copy; `gain1 → gain2` is not.
    expect(items.filter((i) => i.kind === "connection")).toHaveLength(1);
  });

  it("carries nothing when a single component is copied", async () => {
    const items = await captureClipboardItems(copyClient(), wired(), [
      "c:gain1",
    ]);
    expect(items.every((i) => i.kind !== "connection")).toBe(true);
  });
});

describe("pasteClipboardItems: connections", () => {
  const connection: ClipboardConnection = {
    kind: "connection",
    lhs: { component: "gain1", port: "y" },
    rhs: { component: "other", port: "u" },
    waypoints: [
      [20, 10],
      [40, 10],
    ],
    style: { color: [255, 0, 0] },
  };

  it("rewires to the pasted components, not the copied ones", async () => {
    const client = pasteClient();
    const result = await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      [
        componentItem({ name: "gain1" }),
        componentItem({ name: "other" }),
        connection,
      ],
      "diagram",
      PASTE_OFFSET,
    );
    expect(result.connections).toBe(1);
    expect(client.data()).toContain(
      `connect(gain2.y, other1.u) annotation (Line(points={{${20 + PASTE_OFFSET},${10 + PASTE_OFFSET}},{${40 + PASTE_OFFSET},${10 + PASTE_OFFSET}}},color={255,0,0}));`,
    );
  });

  it("declares every component before the equation section", async () => {
    const client = pasteClient();
    await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      [
        componentItem({ name: "gain1" }),
        connection,
        componentItem({ name: "other" }),
      ],
      "diagram",
      PASTE_OFFSET,
    );
    // The connection is listed between the components, but Modelica needs
    // every declaration ahead of the equation section that references them.
    const lines = client.data().split("\n");
    const equation = lines.indexOf("equation");
    expect(equation).toBeGreaterThan(0);
    expect(
      lines.slice(0, equation).every((l) => l.includes("annotation(")),
    ).toBe(true);
    expect(lines.slice(0, equation)).toHaveLength(2);
    expect(lines.slice(equation + 1).join("\n")).toContain("connect(");
  });

  it("drops a connection whose endpoint was not part of the paste", async () => {
    const client = pasteClient();
    const result = await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      // `other` is never declared, so the wire has nothing to attach to.
      [componentItem({ name: "gain1" }), connection],
      "diagram",
      PASTE_OFFSET,
    );
    expect(result.connections).toBe(0);
    expect(client.data()).not.toContain("connect(");
    expect(client.data()).not.toContain("equation");
    expect(result.failed).toEqual([]);
  });

  it("reports one failure and claims nothing when OMC rejects the block", async () => {
    // OMC parses the block as a unit, so a paste cannot half-apply.
    const client = pasteClient(() => "syntax error");
    const result = await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      [
        componentItem({ name: "gain1" }),
        componentItem({ name: "other" }),
        connection,
      ],
      "diagram",
      PASTE_OFFSET,
    );
    expect(result.added).toEqual([]);
    expect(result.connections).toBe(0);
    expect(result.shapes).toBe(0);
    expect(result.failed).toEqual(["paste: syntax error"]);
  });
});

describe("pastedSelectionKeys", () => {
  it("keys the pasted components so the fresh copy is what drags", () => {
    const base = layout();
    const connector = base.connectors.u;
    if (connector === undefined) throw new Error("fixture lost its connector");
    const after: DiagramLayout = {
      ...base,
      connectors: { ...base.connectors, u1: { ...connector, name: "u1" } },
    };
    expect(
      pastedSelectionKeys(
        after,
        { added: ["gain2", "u1"], shapes: 0, connections: 0, failed: [] },
        "diagram",
      ),
    ).toEqual(["c:gain2", "k:u1"]);
  });

  it("keys appended shapes by their tail position in the host layer", () => {
    const after: DiagramLayout = {
      ...layout(),
      diagramLayers: [{ from: "Demo", shapes: [rect, rect, rect] }],
    };
    expect(
      pastedSelectionKeys(
        after,
        { added: [], shapes: 2, connections: 0, failed: [] },
        "diagram",
      ),
    ).toEqual(["shape:rectangle:1", "shape:rectangle:2"]);
  });
});

describe("uniquePasteName", () => {
  it("appends an index to an unnumbered name", () => {
    expect(uniquePasteName("gain", new Set())).toBe("gain1");
  });

  it("re-numbers rather than growing a digit each round", () => {
    expect(uniquePasteName("gain1", new Set(["gain1"]))).toBe("gain2");
    expect(uniquePasteName("gain2", new Set(["gain1", "gain2"]))).toBe("gain3");
  });
});

describe("pasteClipboardItems", () => {
  it("offsets the placement and carries the rotation", async () => {
    const client = pasteClient();
    await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      [componentItem({ rotation: 90 })],
      "diagram",
      PASTE_OFFSET,
    );
    expect(client.data()).toBe(
      `Modelica.Blocks.Math.Gain gain2 annotation(Placement(transformation(extent={{${PASTE_OFFSET},${PASTE_OFFSET}},{${20 + PASTE_OFFSET},${20 + PASTE_OFFSET}}}, rotation=90)));`,
    );
  });

  it("gives each item in one paste a distinct name", async () => {
    // The layout isn't re-fetched mid-paste, so without tracking the names
    // handed out both components would ask for `gain2`.
    const client = pasteClient();
    const result = await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      [componentItem(), componentItem()],
      "diagram",
      PASTE_OFFSET,
    );
    expect(result.added).toEqual(["gain2", "gain3"]);
    expect(client.data().split("\n")).toHaveLength(2);
  });

  it("carries modifiers inline on the declaration, under the pasted name", async () => {
    // Inline is the whole point: a modifier written separately costs another
    // OMC round-trip, and they dominated the cost of a multi-component paste.
    const client = pasteClient();
    await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      [
        componentItem({
          modifiers: [
            { path: "k", expr: "2.5" },
            { path: "limiter.uMax", expr: "5" },
          ],
        }),
      ],
      "diagram",
      PASTE_OFFSET,
    );
    expect(client.data()).toContain(
      "Modelica.Blocks.Math.Gain gain2(k = 2.5, limiter.uMax = 5) annotation(",
    );
  });

  it("keeps a placement origin, which a rotated boundary connector needs", async () => {
    // OMC writes a rotated connector as `origin` plus a small extent. Dropping
    // the origin lands it at {0,0} — the middle of the diagram — instead of on
    // the boundary it was copied from.
    const client = pasteClient();
    await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      [
        componentItem({
          origin: [0, -120],
          extent: [
            [20, -20],
            [-20, 20],
          ],
          rotation: 270,
        }),
      ],
      "diagram",
      0,
    );
    expect(client.data()).toContain(
      "Placement(transformation(origin={0,-120}, extent={{20,-20},{-20,20}}, rotation=270))",
    );
  });

  it("keeps declaration prefixes, which change what the declaration means", async () => {
    // An `inner` pasted plain stops answering the `outer` lookups that
    // referenced it; a `parameter` pasted plain becomes a variable.
    const client = pasteClient();
    await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      [componentItem({ prefixes: { inner: true, variability: "parameter" } })],
      "diagram",
      0,
    );
    expect(client.data()).toContain(
      "inner parameter Modelica.Blocks.Math.Gain gain2",
    );
  });

  it("emits flow/stream from the connector prefix OMC actually sends", async () => {
    // OMC reports these as `connector: "flow" | "stream"`, not as booleans —
    // reading a boolean drops the prefix silently.
    const client = pasteClient();
    await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      [componentItem({ prefixes: { connector: "flow" } })],
      "diagram",
      0,
    );
    expect(client.data()).toContain("flow Modelica.Blocks.Math.Gain gain2");
  });

  it("offsets only the view being pasted into", async () => {
    // The offset is a drop point in the target view's coordinates; applying it
    // to the other view's transformation would move it an unrelated distance.
    const client = pasteClient();
    await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      [
        componentItem({
          extent: [
            [0, 0],
            [10, 10],
          ],
          diagramPlacement: {
            extent: [
              [50, 50],
              [60, 60],
            ],
          },
        }),
      ],
      "diagram",
      20,
    );
    expect(client.data()).toContain(
      "transformation(extent={{70,70},{80,80}}), iconTransformation(extent={{0,0},{10,10}})",
    );
  });

  it("re-emits a connector's other-view placement as iconTransformation", async () => {
    // A connector is placed once per view; keeping only the one it was read
    // from loses its position in the other.
    const client = pasteClient();
    await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      [
        componentItem({
          extent: [
            [-140, -20],
            [-100, 20],
          ],
          diagramPlacement: {
            extent: [
              [-110, -10],
              [-90, 10],
            ],
          },
        }),
      ],
      "diagram",
      0,
    );
    // The item's own extent is the icon-view placement when a diagram one is
    // present, so each has to come back out under its own keyword.
    expect(client.data()).toContain(
      "Placement(transformation(extent={{-110,-10},{-90,10}}), iconTransformation(extent={{-140,-20},{-100,20}}))",
    );
  });

  it("carries visible=false and the description comment", async () => {
    const client = pasteClient();
    await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      [componentItem({ visible: false, comment: "the gain" })],
      "diagram",
      0,
    );
    expect(client.data()).toContain('gain2 "the gain" annotation(');
    expect(client.data()).toContain("Placement(visible=false, transformation(");
  });

  it("carries a string-valued modifier through the block intact", async () => {
    // The block is concatenated text now, so a quoted expression is the case
    // that would break it if anything re-escaped on the way through.
    const client = pasteClient();
    await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      [componentItem({ modifiers: [{ path: "unit", expr: '"m/s"' }] })],
      "diagram",
      PASTE_OFFSET,
    );
    expect(client.data()).toContain('gain2(unit = "m/s") annotation(');
  });

  it("emits no modifier parentheses when the declaration has none", async () => {
    const client = pasteClient();
    await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      [componentItem()],
      "diagram",
      PASTE_OFFSET,
    );
    expect(client.data()).toContain("Gain gain2 annotation(");
  });

  it("writes a shape into the receiving editor's layer, offset via origin", async () => {
    const client = pasteClient();
    const items: ClipboardEntry[] = [{ kind: "shape", shape: rect }];
    const result = await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      items,
      "icon",
      PASTE_OFFSET,
    );
    expect(result.shapes).toBe(1);
    // OMC merges this into the class's existing graphics rather than
    // replacing them, so the annotation carries only what the paste adds.
    expect(client.data()).toBe(
      `annotation (Icon(graphics={Rectangle(origin={${PASTE_OFFSET}, ${PASTE_OFFSET}}, fillColor={255, 0, 0}, extent={{-10, -10}, {10, 10}})}));`,
    );
  });

  it("targets the diagram layer when that is the editor", async () => {
    const client = pasteClient();
    await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      [{ kind: "shape", shape: rect }],
      "diagram",
      PASTE_OFFSET,
    );
    expect(client.data()).toContain("annotation (Diagram(graphics={");
  });

  it("makes no OMC call when there is nothing to paste", async () => {
    const client = pasteClient();
    const result = await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      [],
      "diagram",
      PASTE_OFFSET,
    );
    expect(client.calls).toEqual([]);
    expect(result).toEqual({
      added: [],
      shapes: 0,
      connections: 0,
      failed: [],
    });
  });

  it("pastes components, connections and shapes in one call", async () => {
    const client = pasteClient();
    const result = await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      [
        componentItem({ name: "gain1" }),
        componentItem({ name: "other" }),
        {
          kind: "connection",
          lhs: { component: "gain1", port: "y" },
          rhs: { component: "other", port: "u" },
          waypoints: [],
          style: {},
        },
        { kind: "shape", shape: rect },
      ],
      "diagram",
      PASTE_OFFSET,
    );
    expect(client.calls).toHaveLength(1);
    expect(result).toMatchObject({
      added: ["gain2", "other1"],
      connections: 1,
      shapes: 1,
      failed: [],
    });
  });
});

describe("DiagramClipboard", () => {
  it("starts empty and fills on write", () => {
    const clipboard = new DiagramClipboard();
    expect(clipboard.isEmpty).toBe(true);
    clipboard.write([componentItem()]);
    expect(clipboard.isEmpty).toBe(false);
  });

  it("cascades successive pastes into one class", () => {
    const clipboard = new DiagramClipboard();
    clipboard.write([componentItem()]);
    expect(clipboard.nextOffset("Demo")).toBe(PASTE_OFFSET);
    expect(clipboard.nextOffset("Demo")).toBe(2 * PASTE_OFFSET);
  });

  it("cascades per class, so a second model starts at the first offset", () => {
    // The cascade exists so a paste doesn't land on the previous one, which is
    // only true within a class. Offsetting a first paste into `Other` by two
    // steps would drop it where nothing sits.
    const clipboard = new DiagramClipboard();
    clipboard.write([componentItem()]);
    clipboard.nextOffset("Demo");
    expect(clipboard.nextOffset("Other")).toBe(PASTE_OFFSET);
  });

  it("restarts the cascade on a fresh copy", () => {
    const clipboard = new DiagramClipboard();
    clipboard.write([componentItem()]);
    clipboard.nextOffset("Demo");
    clipboard.write([componentItem()]);
    expect(clipboard.nextOffset("Demo")).toBe(PASTE_OFFSET);
  });
});
