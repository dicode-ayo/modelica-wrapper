import { describe, expect, it } from "vitest";
import type { DiagramLayout } from "@dicode/omc-client";

import type { Command, CommandTarget } from "../src/commands/command.js";
import {
  DEFAULT_KEYMAP,
  DIAGRAM_COMMANDS,
} from "../src/commands/diagram-commands.js";
import { CommandRegistry } from "../src/commands/registry.js";
import type { ContextKeys } from "../src/interaction/context-keys.js";

function layout(): DiagramLayout {
  return {
    kind: "diagram",
    className: "Demo",
    source: { file: "demo.mo", line: 1, column: 1 } as never,
    iconLayers: [],
    diagramLayers: [],
    labels: [],
    classes: {},
    components: {
      R1: {
        name: "R1",
        classRef: "Modelica.Electrical.Resistor",
        placement: {
          extent: [
            [-10, -5],
            [10, 5],
          ],
        },
      },
    },
    connectors: {},
    connections: [],
  };
}

interface SpyTarget extends CommandTarget {
  committed: DiagramLayout[];
  selections: string[][];
}

function spyTarget(l: DiagramLayout, keys: string[]): SpyTarget {
  const committed: DiagramLayout[] = [];
  const selections: string[][] = [];
  return {
    layout: l,
    selectedKeys: new Set(keys),
    contextVertex: null,
    commitLayout: (n) => committed.push(n),
    setSelection: (k) => selections.push([...k]),
    committed,
    selections,
  };
}

function command(id: string): Command {
  const c = DIAGRAM_COMMANDS.find((x) => x.id === id);
  if (!c) throw new Error(`no command ${id}`);
  return c;
}

function ctx(patch: Partial<ContextKeys> = {}): ContextKeys {
  return {
    mode: "select",
    gesture: "idle",
    selectionKind: "component",
    selectionCount: 1,
    readonly: false,
    viewLayer: "diagram",
    hasClipboard: false,
    vertexTarget: false,
    polySelection: false,
    hasDefinitionSource: false,
    hasDeclarationSource: false,
    ...patch,
  };
}

describe("DIAGRAM_COMMANDS", () => {
  it("rotateCw commits a rotated layout", () => {
    const t = spyTarget(layout(), ["c:R1"]);
    command("diagram.rotateCw").run(t);
    expect(t.committed).toHaveLength(1);
    expect(t.committed[0]?.components.R1?.placement.rotation).toBe(270);
  });

  it("delete commits the pruned layout and clears the selection", () => {
    const t = spyTarget(layout(), ["c:R1"]);
    command("diagram.delete").run(t);
    expect(t.committed).toHaveLength(1);
    expect(t.committed[0]?.components.R1).toBeUndefined();
    expect(t.selections).toEqual([[]]);
  });

  it("does not commit when no selected key matches", () => {
    const t = spyTarget(layout(), ["c:bogus"]);
    command("diagram.rotateCw").run(t);
    expect(t.committed).toHaveLength(0);
  });

  it("does not commit when there is no layout", () => {
    const t = spyTarget(layout(), ["c:R1"]);
    command("diagram.flipHorizontal").run({ ...t, layout: null });
    expect(t.committed).toHaveLength(0);
  });

  it("the selection edit ops require a non-readonly, non-empty selection", () => {
    const selectionOps = [
      "diagram.delete",
      "diagram.rotateCw",
      "diagram.rotateCcw",
      "diagram.flipHorizontal",
      "diagram.flipVertical",
    ];
    for (const id of selectionOps) {
      const when = command(id).when;
      if (!when) throw new Error(`${id} should gate on selection`);
      expect(when(ctx())).toBe(true);
      expect(when(ctx({ selectionCount: 0, selectionKind: "none" }))).toBe(
        false,
      );
      expect(when(ctx({ readonly: true }))).toBe(false);
    }
  });

  it("deleteVertex gates on a right-clicked vertex; toggleSmooth on a poly selection", () => {
    const del = command("diagram.deleteVertex").when;
    const smooth = command("diagram.toggleSmooth").when;
    if (!del || !smooth) throw new Error("missing gate");
    // Neither fires off a plain selection.
    expect(del(ctx())).toBe(false);
    expect(smooth(ctx())).toBe(false);
    // Each fires on its own context, and never when read-only.
    expect(del(ctx({ vertexTarget: true }))).toBe(true);
    expect(del(ctx({ vertexTarget: true, readonly: true }))).toBe(false);
    expect(smooth(ctx({ polySelection: true }))).toBe(true);
    expect(smooth(ctx({ polySelection: true, readonly: true }))).toBe(false);
  });

  it("deleteVertex parses its vertex key and drops that point", () => {
    const polyLayout: DiagramLayout = {
      ...layout(),
      diagramLayers: [
        {
          from: "Demo",
          shapes: [
            {
              kind: "line",
              points: [
                [0, 0],
                [10, 0],
                [20, 0],
              ],
            },
          ],
        },
      ],
    };
    const t = spyTarget(polyLayout, []);
    command("diagram.deleteVertex").run({
      ...t,
      contextVertex: "vtx:line:0/1",
    });
    expect(t.committed).toHaveLength(1);
    expect(t.committed[0]?.diagramLayers[0]?.shapes[0]).toMatchObject({
      points: [
        [0, 0],
        [20, 0],
      ],
    });
  });

  it("showKeymapHelp delegates to target.showKeymapHelp and tolerates its absence", () => {
    const t = spyTarget(layout(), []);
    let opened = false;
    command("diagram.showKeymapHelp").run({
      ...t,
      showKeymapHelp: () => {
        opened = true;
      },
    });
    expect(opened).toBe(true);
    expect(() => command("diagram.showKeymapHelp").run(t)).not.toThrow();
  });

  it("showKeymapHelp has no when gate — always available", () => {
    expect(command("diagram.showKeymapHelp").when).toBeUndefined();
  });

  it("every default key binding resolves to a registered command", () => {
    const registry = new CommandRegistry(DIAGRAM_COMMANDS);
    for (const id of DEFAULT_KEYMAP.values()) {
      expect(registry.get(id)).toBeDefined();
    }
  });

  it("places the edit ops in the context menu only when a selection exists", () => {
    const registry = new CommandRegistry(DIAGRAM_COMMANDS);
    expect(
      registry.commandsFor("contextMenu", ctx()).map((m) => m.command.id),
    ).toEqual([
      "diagram.copy",
      "diagram.delete",
      "diagram.rotateCw",
      "diagram.rotateCcw",
      "diagram.flipHorizontal",
      "diagram.flipVertical",
      "diagram.changeClass",
    ]);
    expect(
      registry.commandsFor(
        "contextMenu",
        ctx({ selectionCount: 0, selectionKind: "none" }),
      ),
    ).toEqual([]);
  });

  it("copy stays available on a read-only class", () => {
    const when = command("diagram.copy").when;
    if (!when) throw new Error("copy should gate on selection");
    expect(when(ctx({ readonly: true }))).toBe(true);
    expect(when(ctx({ selectionCount: 0, selectionKind: "none" }))).toBe(false);
  });

  it("paste needs a filled clipboard and a writable class", () => {
    const when = command("diagram.paste").when;
    if (!when) throw new Error("paste should gate on the clipboard");
    expect(when(ctx({ hasClipboard: true }))).toBe(true);
    expect(when(ctx({ hasClipboard: false }))).toBe(false);
    expect(when(ctx({ hasClipboard: true, readonly: true }))).toBe(false);
  });

  it("paste shows with an empty selection once the clipboard is filled", () => {
    const registry = new CommandRegistry(DIAGRAM_COMMANDS);
    expect(
      registry
        .commandsFor(
          "contextMenu",
          ctx({
            selectionCount: 0,
            selectionKind: "none",
            hasClipboard: true,
          }),
        )
        .map((m) => m.command.id),
    ).toEqual(["diagram.paste"]);
  });

  it("copy and paste delegate to the host, which owns the clipboard", () => {
    const t = spyTarget(layout(), ["c:R1"]);
    const actions: string[] = [];
    const target = {
      ...t,
      requestClipboard: (action: "copy" | "paste") => actions.push(action),
    };
    command("diagram.copy").run(target);
    command("diagram.paste").run(target);
    expect(actions).toEqual(["copy", "paste"]);
    expect(t.committed).toHaveLength(0);
  });

  it("copy and paste tolerate a target that cannot reach a clipboard", () => {
    const t = spyTarget(layout(), ["c:R1"]);
    expect(() => command("diagram.copy").run(t)).not.toThrow();
    expect(() => command("diagram.paste").run(t)).not.toThrow();
  });

  it("binds copy and paste to the clipboard chords", () => {
    expect(DEFAULT_KEYMAP.get("ctrl+c")).toBe("diagram.copy");
    expect(DEFAULT_KEYMAP.get("ctrl+v")).toBe("diagram.paste");
  });
});

describe("selectAll", () => {
  it("selects every entity, including shapes a rubber band would miss", () => {
    const l: DiagramLayout = {
      ...layout(),
      diagramLayers: [
        {
          from: "Demo",
          shapes: [
            {
              kind: "rectangle",
              extent: [
                [0, 0],
                [1, 1],
              ],
            },
          ],
        },
      ],
    };
    const t = spyTarget(l, []);
    command("diagram.selectAll").run(t);
    expect(t.selections).toEqual([["c:R1", "shape:rectangle:0"]]);
    expect(t.committed).toEqual([]);
  });

  it("does not need a prior selection, unlike the edit ops", () => {
    const when = command("diagram.selectAll").when;
    if (!when) throw new Error("expected a gate");
    expect(when(ctx({ selectionCount: 0, selectionKind: "none" }))).toBe(true);
    // A read-only class still selects; only the edits are refused.
    expect(when(ctx({ readonly: true }))).toBe(true);
    // An armed draw tool owns the canvas.
    expect(when(ctx({ mode: "draw" }))).toBe(false);
  });

  it("has no context-menu placement, so a bare-canvas right-click stays empty", () => {
    expect(command("diagram.selectAll").placements ?? []).toEqual([]);
  });
});

describe("z-order commands", () => {
  const A: DiagramLayout["diagramLayers"][number]["shapes"][number] = {
    kind: "rectangle",
    extent: [
      [0, 0],
      [1, 1],
    ],
  };
  const B: typeof A = {
    kind: "rectangle",
    extent: [
      [2, 2],
      [3, 3],
    ],
  };
  const C: typeof A = {
    kind: "rectangle",
    extent: [
      [4, 4],
      [5, 5],
    ],
  };

  /** `layout()` with three host-owned diagram shapes. */
  function shaped(): DiagramLayout {
    return {
      ...layout(),
      diagramLayers: [{ from: "Demo", shapes: [A, B, C] }],
    };
  }

  function own(l: DiagramLayout | undefined): unknown[] {
    return l?.diagramLayers.find((x) => x.from === "Demo")?.shapes ?? [];
  }

  it("bringToFront moves the shape to the end of the paint order", () => {
    const t = spyTarget(shaped(), ["shape:rectangle:0"]);
    command("diagram.bringToFront").run(t);
    expect(own(t.committed[0])).toEqual([B, C, A]);
  });

  it("sendToBack moves the shape to the start", () => {
    const t = spyTarget(shaped(), ["shape:rectangle:2"]);
    command("diagram.sendToBack").run(t);
    expect(own(t.committed[0])).toEqual([C, A, B]);
  });

  it("bringForward and sendBackward step one slot", () => {
    const fwd = spyTarget(shaped(), ["shape:rectangle:0"]);
    command("diagram.bringForward").run(fwd);
    expect(own(fwd.committed[0])).toEqual([B, A, C]);

    const back = spyTarget(shaped(), ["shape:rectangle:2"]);
    command("diagram.sendBackward").run(back);
    expect(own(back.committed[0])).toEqual([A, C, B]);
  });

  it("re-keys the selection to the shape's new index", () => {
    // Shape keys are positional, so without this the selection would follow
    // whichever shape slid into the vacated slot.
    const t = spyTarget(shaped(), ["shape:rectangle:0"]);
    command("diagram.bringToFront").run(t);
    expect(t.selections).toEqual([["shape:rectangle:2"]]);
  });

  it("does not commit when the shape is already at that end", () => {
    const front = spyTarget(shaped(), ["shape:rectangle:2"]);
    command("diagram.bringToFront").run(front);
    expect(front.committed).toHaveLength(0);
    expect(front.selections).toHaveLength(0);

    const back = spyTarget(shaped(), ["shape:rectangle:0"]);
    command("diagram.sendToBack").run(back);
    expect(back.committed).toHaveLength(0);
  });

  it("does not commit for a non-shape selection or a missing layout", () => {
    const comp = spyTarget(shaped(), ["c:R1"]);
    command("diagram.bringToFront").run(comp);
    expect(comp.committed).toHaveLength(0);

    const none = spyTarget(shaped(), ["shape:rectangle:0"]);
    command("diagram.bringToFront").run({ ...none, layout: null });
    expect(none.committed).toHaveLength(0);
  });

  it("does not commit for a malformed shape key", () => {
    // `parseShapeId` fails closed to NaN rather than throwing, so the index
    // guard is what stops a bad key reaching the array.
    const t = spyTarget(shaped(), ["shape:rectangle:x"]);
    command("diagram.bringToFront").run(t);
    expect(t.committed).toHaveLength(0);
    expect(t.selections).toHaveLength(0);
  });

  it("gates on exactly one selected shape, and never read-only", () => {
    const ids = [
      "diagram.bringToFront",
      "diagram.bringForward",
      "diagram.sendBackward",
      "diagram.sendToBack",
    ];
    for (const id of ids) {
      const when = command(id).when;
      if (!when) throw new Error(`${id} should gate on a shape selection`);
      expect(when(ctx({ selectionKind: "shape" }))).toBe(true);
      // A component selection has no paint order to change.
      expect(when(ctx({ selectionKind: "component" }))).toBe(false);
      // Two shapes have no single destination.
      expect(when(ctx({ selectionKind: "shape", selectionCount: 2 }))).toBe(
        false,
      );
      expect(when(ctx({ selectionKind: "shape", readonly: true }))).toBe(false);
    }
  });
});
