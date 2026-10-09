/**
 * Unit tests for `diagram.openDiagram`: resolution of the selection to a
 * class, the `when` gate, and its placement above the source-navigation
 * entries in the context menu.
 */

import { describe, expect, it, vi } from "vitest";
import type { DiagramLayout } from "@dicode/omc-client";

import { commandsToMenuItems } from "../context-menu/command-menu-items.js";
import { makeContextKeys } from "../interaction/context-keys.fixture.js";
import type { Command, CommandTarget } from "./command.js";
import {
  CommandRegistry,
  DEFAULT_KEYMAP,
  DIAGRAM_COMMANDS,
  resolveOpenDiagramClass,
} from "./index.js";

const EXTENT = [
  [-10, -10],
  [10, 10],
] as [[number, number], [number, number]];

function makeLayout(): DiagramLayout {
  return {
    kind: "diagram",
    className: "Pkg.M",
    iconLayers: [],
    diagramLayers: [],
    labels: [],
    classes: { g: { name: "Modelica.Blocks.Math.Gain" } },
    components: {
      gain1: { name: "gain1", classRef: "g", placement: { extent: EXTENT } },
      unnamed: {
        name: "unnamed",
        classRef: "Pkg.Unknown",
        placement: { extent: EXTENT },
      },
    },
    connectors: {
      p: { name: "p", classRef: "Pin", placement: { extent: EXTENT } },
    },
    connections: [],
  } as unknown as DiagramLayout;
}

function command(id: string): Command {
  const c = DIAGRAM_COMMANDS.find((x) => x.id === id);
  if (!c) throw new Error(`no command ${id}`);
  return c;
}

describe("resolveOpenDiagramClass", () => {
  const layout = makeLayout();

  it("resolves a selected component to its type's qualified name", () => {
    expect(resolveOpenDiagramClass(layout, new Set(["c:gain1"]))).toBe(
      "Modelica.Blocks.Math.Gain",
    );
  });

  it("falls back to the class reference when the layout carries no class entry", () => {
    expect(resolveOpenDiagramClass(layout, new Set(["c:unnamed"]))).toBe(
      "Pkg.Unknown",
    );
  });

  it("resolves nothing for the bare canvas, other entities, multi-selection or no layout", () => {
    expect(resolveOpenDiagramClass(layout, new Set())).toBeNull();
    expect(resolveOpenDiagramClass(layout, new Set(["k:p"]))).toBeNull();
    expect(resolveOpenDiagramClass(layout, new Set(["edge:0"]))).toBeNull();
    expect(resolveOpenDiagramClass(layout, new Set(["c:ghost"]))).toBeNull();
    expect(
      resolveOpenDiagramClass(layout, new Set(["c:gain1", "c:unnamed"])),
    ).toBeNull();
    expect(resolveOpenDiagramClass(null, new Set(["c:gain1"]))).toBeNull();
  });
});

describe("diagram.openDiagram command", () => {
  const cmd = command("diagram.openDiagram");

  function target(keys: string[]): {
    target: CommandTarget;
    requestOpenDiagram: ReturnType<typeof vi.fn>;
  } {
    const requestOpenDiagram = vi.fn();
    return {
      target: {
        layout: makeLayout(),
        selectedKeys: new Set(keys),
        contextVertex: null,
        commitLayout: vi.fn(),
        setSelection: vi.fn(),
        requestOpenDiagram,
      },
      requestOpenDiagram,
    };
  }

  it("delegates the component's class to requestOpenDiagram", () => {
    const t = target(["c:gain1"]);
    cmd.run(t.target);
    expect(t.requestOpenDiagram).toHaveBeenCalledExactlyOnceWith(
      "Modelica.Blocks.Math.Gain",
    );
  });

  it("does nothing when no class resolves", () => {
    const t = target([]);
    cmd.run(t.target);
    expect(t.requestOpenDiagram).not.toHaveBeenCalled();
  });

  it("is gated on hasOpenDiagramClass and ignores readonly", () => {
    expect(cmd.when?.(makeContextKeys({ hasOpenDiagramClass: true }))).toBe(
      true,
    );
    expect(
      cmd.when?.(
        makeContextKeys({ hasOpenDiagramClass: true, readonly: true }),
      ),
    ).toBe(true);
    expect(cmd.when?.(makeContextKeys())).toBe(false);
  });

  it("lists above Go to Definition and Go to Declaration in the context menu", () => {
    const registry = new CommandRegistry(DIAGRAM_COMMANDS);
    const ids = commandsToMenuItems(
      registry.commandsFor(
        "contextMenu",
        makeContextKeys({
          selectionKind: "component",
          selectionCount: 1,
          hasOpenDiagramClass: true,
          hasDefinitionSource: true,
          hasDeclarationSource: true,
        }),
      ),
    ).map((i) => i.id);
    const navigate = ids.slice(ids.indexOf("diagram.openDiagram"));
    expect(navigate).toEqual([
      "diagram.openDiagram",
      "diagram.goToDefinition",
      "diagram.goToDeclaration",
    ]);
  });

  it("leaves F12 on Go to Definition", () => {
    expect(DEFAULT_KEYMAP.get("F12")).toBe("diagram.goToDefinition");
    expect([...DEFAULT_KEYMAP.values()]).not.toContain("diagram.openDiagram");
  });
});
