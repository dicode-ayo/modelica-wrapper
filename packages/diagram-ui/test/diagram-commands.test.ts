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

  it("every command requires a non-readonly, non-empty selection", () => {
    for (const c of DIAGRAM_COMMANDS) {
      const when = c.when;
      if (!when) throw new Error(`${c.id} should gate on selection`);
      expect(when(ctx())).toBe(true);
      expect(when(ctx({ selectionCount: 0, selectionKind: "none" }))).toBe(
        false,
      );
      expect(when(ctx({ readonly: true }))).toBe(false);
    }
  });

  it("every default key binding resolves to a registered command", () => {
    const registry = new CommandRegistry(DIAGRAM_COMMANDS);
    for (const id of DEFAULT_KEYMAP.values()) {
      expect(registry.get(id)).toBeDefined();
    }
  });

  it("places the edit ops in the context menu only when a selection exists", () => {
    const registry = new CommandRegistry(DIAGRAM_COMMANDS);
    expect(registry.commandsFor("contextMenu", ctx()).map((c) => c.id)).toEqual(
      [
        "diagram.delete",
        "diagram.rotateCw",
        "diagram.rotateCcw",
        "diagram.flipHorizontal",
        "diagram.flipVertical",
      ],
    );
    expect(
      registry.commandsFor(
        "contextMenu",
        ctx({ selectionCount: 0, selectionKind: "none" }),
      ),
    ).toEqual([]);
  });
});
