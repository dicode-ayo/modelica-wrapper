import { describe, expect, it } from "vitest";

import type { DiagramLayout, RectangleShape } from "@dicode/omc-client";

import {
  DiagramClipboard,
  PASTE_OFFSET,
  type ClipboardComponent,
  type ClipboardEntry,
} from "./clipboard.js";
import {
  captureClipboardItems,
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

interface PasteCall {
  fn: string;
  arg: unknown;
}

function pasteClient(
  reject: (call: PasteCall) => string | null = () => null,
): PasteClient & { calls: PasteCall[] } {
  const calls: PasteCall[] = [];
  const record = (
    fn: string,
    arg: unknown,
  ): Promise<{
    success: boolean;
    diagnostic?: string | undefined;
  }> => {
    const call = { fn, arg };
    calls.push(call);
    const diagnostic = reject(call);
    return Promise.resolve(
      diagnostic === null ? { success: true } : { success: false, diagnostic },
    );
  };
  return {
    calls,
    addComponent: (arg) => record("addComponent", arg),
    setElementModifierValue: (arg) => record("setElementModifierValue", arg),
    writeClassGraphics: (arg) => record("writeClassGraphics", arg),
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
    expect(client.calls[0]?.arg).toMatchObject({
      componentName: "gain2",
      intoTypeName: "Demo",
      annotation: `Placement(transformation(extent={{${PASTE_OFFSET},${PASTE_OFFSET}},{${20 + PASTE_OFFSET},${20 + PASTE_OFFSET}}}, rotation=90))`,
    });
  });

  it("gives each item in one paste a distinct name", async () => {
    // The layout isn't re-fetched between adds, so without tracking the names
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
  });

  it("replays modifiers onto the pasted instance, not the copied one", async () => {
    const client = pasteClient();
    await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      [componentItem({ modifiers: [{ path: "k", expr: "2.5" }] })],
      "diagram",
      PASTE_OFFSET,
    );
    expect(client.calls[1]).toEqual({
      fn: "setElementModifierValue",
      arg: { typeName: "Demo", elementName: "gain2.k", expr: "2.5" },
    });
  });

  it("writes a shape to the receiving editor's layer, offset via origin", async () => {
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
    expect(client.calls[0]?.arg).toMatchObject({
      layer: "icon",
      op: {
        kind: "add",
        shape: { ...rect, origin: [PASTE_OFFSET, PASTE_OFFSET] },
      },
    });
  });

  it("reports a rejected add and skips its modifier writes", async () => {
    const client = pasteClient((c) =>
      c.fn === "addComponent" ? "class not found" : null,
    );
    const result = await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      [componentItem({ modifiers: [{ path: "k", expr: "2.5" }] })],
      "diagram",
      PASTE_OFFSET,
    );
    expect(result.added).toEqual([]);
    expect(result.failed).toEqual([
      "paste Modelica.Blocks.Math.Gain: class not found",
    ]);
    expect(client.calls.map((c) => c.fn)).toEqual(["addComponent"]);
  });

  it("keeps the name of a component whose modifier write failed", async () => {
    // The declaration reached the class even though the modifier didn't —
    // handing the name out again would declare it twice.
    const client = pasteClient((c) =>
      c.fn === "setElementModifierValue" ? "bad modifier" : null,
    );
    const result = await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      [
        componentItem({ modifiers: [{ path: "k", expr: "2.5" }] }),
        componentItem(),
      ],
      "diagram",
      PASTE_OFFSET,
    );
    expect(
      client.calls
        .filter((c) => c.fn === "addComponent")
        .map((c) => (c.arg as { componentName: string }).componentName),
    ).toEqual(["gain2", "gain3"]);
    // The half-applied component still counts as added, so the caller reflects
    // it and it gets an undo step.
    expect(result.added).toEqual(["gain2", "gain3"]);
    expect(result.failed).toEqual(["paste gain2.k: bad modifier"]);
  });

  it("frees the name a rejected add reserved, so the next item can take it", async () => {
    let first = true;
    const client = pasteClient((c) => {
      if (c.fn !== "addComponent") return null;
      if (first) {
        first = false;
        return "rejected";
      }
      return null;
    });
    const result = await pasteClipboardItems(
      client,
      "Demo",
      layout(),
      [componentItem(), componentItem()],
      "diagram",
      PASTE_OFFSET,
    );
    expect(result.added).toEqual(["gain2"]);
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
