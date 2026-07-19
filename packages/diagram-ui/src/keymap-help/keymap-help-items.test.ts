import { describe, expect, it } from "vitest";

import { CommandRegistry } from "../commands/registry.js";
import {
  DEFAULT_KEYMAP,
  DIAGRAM_COMMANDS,
} from "../commands/diagram-commands.js";
import { makeContextKeys } from "../interaction/context-keys.fixture.js";
import { commandsToKeymapHelpGroups } from "./keymap-help-items.js";

describe("commandsToKeymapHelpGroups", () => {
  const registry = new CommandRegistry(DIAGRAM_COMMANDS);

  it("groups bound commands by category, formatting every chord for display", () => {
    const groups = commandsToKeymapHelpGroups(
      registry,
      DEFAULT_KEYMAP,
      makeContextKeys(),
    );

    const editGroup = groups.find((g) => g.category === "Edit");
    expect(editGroup).toBeDefined();
    const deleteItem = editGroup?.items.find((i) => i.id === "diagram.delete");
    expect(deleteItem?.chords).toEqual(["Delete", "Backspace"]);
    const rotateItem = editGroup?.items.find(
      (i) => i.id === "diagram.rotateCw",
    );
    expect(rotateItem?.chords).toEqual(["R"]);
    const flipItem = editGroup?.items.find(
      (i) => i.id === "diagram.flipVertical",
    );
    expect(flipItem?.chords).toEqual(["Shift+F"]);
  });

  it("omits commands with no bound chord (e.g. changeClass)", () => {
    const groups = commandsToKeymapHelpGroups(
      registry,
      DEFAULT_KEYMAP,
      makeContextKeys(),
    );
    const ids = groups.flatMap((g) => g.items.map((i) => i.id));
    expect(ids).not.toContain("diagram.changeClass");
  });

  it("resolves enabled against the given context, matching the command's when", () => {
    const withSelection = commandsToKeymapHelpGroups(
      registry,
      DEFAULT_KEYMAP,
      makeContextKeys({ selectionCount: 1, selectionKind: "component" }),
    );
    const withoutSelection = commandsToKeymapHelpGroups(
      registry,
      DEFAULT_KEYMAP,
      makeContextKeys(),
    );

    const enabledRotate = withSelection
      .flatMap((g) => g.items)
      .find((i) => i.id === "diagram.rotateCw");
    const disabledRotate = withoutSelection
      .flatMap((g) => g.items)
      .find((i) => i.id === "diagram.rotateCw");

    expect(enabledRotate?.enabled).toBe(true);
    expect(disabledRotate?.enabled).toBe(false);
  });

  it("always includes the always-on showKeymapHelp command under Help", () => {
    const groups = commandsToKeymapHelpGroups(
      registry,
      DEFAULT_KEYMAP,
      makeContextKeys(),
    );
    const helpGroup = groups.find((g) => g.category === "Help");
    const helpItem = helpGroup?.items.find(
      (i) => i.id === "diagram.showKeymapHelp",
    );
    expect(helpItem).toEqual({
      id: "diagram.showKeymapHelp",
      title: "Show keyboard shortcuts",
      chords: ["Shift+?"],
      enabled: true,
    });
  });
});
