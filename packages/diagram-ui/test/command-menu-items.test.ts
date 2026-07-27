import { describe, expect, it } from "vitest";

import { commandsToMenuItems } from "../src/context-menu/command-menu-items.js";
import { CommandRegistry, DIAGRAM_COMMANDS } from "../src/commands/index.js";
import type { ContextKeys } from "../src/interaction/context-keys.js";
import { makeContextKeys } from "../src/interaction/context-keys.fixture.js";

function ctx(patch: Partial<ContextKeys> = {}): ContextKeys {
  return makeContextKeys({
    selectionKind: "component",
    selectionCount: 1,
    ...patch,
  });
}

describe("commandsToMenuItems", () => {
  const registry = new CommandRegistry(DIAGRAM_COMMANDS);

  it("maps the registry's context-menu commands to id/label/group items", () => {
    const items = commandsToMenuItems(
      registry.commandsFor("contextMenu", ctx()),
    );
    expect(items.map((i) => i.id)).toEqual([
      "diagram.copy",
      "diagram.delete",
      "diagram.rotateCw",
      "diagram.rotateCcw",
      "diagram.flipHorizontal",
      "diagram.flipVertical",
      "diagram.changeClass",
    ]);
    expect(items[0]).toMatchObject({ label: "Copy", group: "clipboard" });
    expect(items[1]).toMatchObject({ label: "Delete", group: "edit" });
    // commandsFor pre-filters by `when`, so nothing is disabled.
    expect(items.every((i) => i.disabled === undefined)).toBe(true);
  });

  it("yields no items when nothing is selected", () => {
    expect(
      commandsToMenuItems(
        registry.commandsFor("contextMenu", ctx({ selectionCount: 0 })),
      ),
    ).toEqual([]);
  });
});
