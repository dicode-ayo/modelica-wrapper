import { describe, expect, it } from "vitest";

import type { Command, CommandTarget } from "../src/commands/command.js";
import { CommandRegistry } from "../src/commands/registry.js";
import type { ContextKeys } from "../src/interaction/context-keys.js";

const NO_TARGET = {} as CommandTarget;

function ctx(patch: Partial<ContextKeys> = {}): ContextKeys {
  return {
    mode: "select",
    gesture: "idle",
    selectionKind: "none",
    selectionCount: 0,
    readonly: false,
    viewLayer: "diagram",
    hasClipboard: false,
    ...patch,
  };
}

const cmd = (over: Partial<Command> = {}): Command => ({
  id: "a",
  title: "A",
  category: "Edit",
  run: () => {},
  ...over,
});

describe("CommandRegistry", () => {
  it("registers and looks up by id", () => {
    const c = cmd();
    const reg = new CommandRegistry([c]);
    expect(reg.get("a")).toBe(c);
    expect(reg.all()).toEqual([c]);
  });

  it("throws on a duplicate id", () => {
    expect(() => new CommandRegistry([cmd(), cmd()])).toThrow(/duplicate/);
  });

  it("runs a command whose when holds and reports that it fired", () => {
    let ran = false;
    const reg = new CommandRegistry([
      cmd({ when: (c) => c.selectionCount > 0, run: () => (ran = true) }),
    ]);
    expect(reg.run("a", ctx({ selectionCount: 1 }), NO_TARGET)).toBe(true);
    expect(ran).toBe(true);
  });

  it("skips a command whose when fails", () => {
    let ran = false;
    const reg = new CommandRegistry([
      cmd({ when: (c) => c.selectionCount > 0, run: () => (ran = true) }),
    ]);
    expect(reg.run("a", ctx(), NO_TARGET)).toBe(false);
    expect(ran).toBe(false);
  });

  it("returns false for an unknown id", () => {
    expect(new CommandRegistry().run("nope", ctx(), NO_TARGET)).toBe(false);
  });

  it("isEnabled reflects the when predicate (and false for unknown)", () => {
    const reg = new CommandRegistry([cmd({ when: (c) => !c.readonly })]);
    expect(reg.isEnabled("a", ctx())).toBe(true);
    expect(reg.isEnabled("a", ctx({ readonly: true }))).toBe(false);
    expect(reg.isEnabled("missing", ctx())).toBe(false);
  });

  describe("commandsFor", () => {
    const reg = new CommandRegistry([
      cmd({ id: "b", placements: [{ surface: "contextMenu", order: 1 }] }),
      cmd({ id: "a", placements: [{ surface: "contextMenu", order: 0 }] }),
      cmd({ id: "t", placements: [{ surface: "toolbar" }] }),
      cmd({ id: "none" }),
    ]);

    it("returns a surface's commands ordered by group then order", () => {
      expect(
        reg.commandsFor("contextMenu", ctx()).map((m) => m.command.id),
      ).toEqual(["a", "b"]);
    });

    it("carries the resolved placement so the view can group", () => {
      const [first] = reg.commandsFor("contextMenu", ctx());
      expect(first?.placement.surface).toBe("contextMenu");
      expect(first?.placement.order).toBe(0);
    });

    it("filters by surface", () => {
      expect(
        reg.commandsFor("toolbar", ctx()).map((m) => m.command.id),
      ).toEqual(["t"]);
      expect(reg.commandsFor("actionMenu", ctx())).toEqual([]);
    });

    it("hides a placement whose when fails, falling back to command.when", () => {
      const r = new CommandRegistry([
        cmd({
          id: "sel",
          when: (c) => c.selectionCount > 0,
          placements: [{ surface: "contextMenu", order: 1 }],
        }),
        cmd({
          id: "explicit",
          placements: [
            { surface: "contextMenu", order: 0, when: (c) => !c.readonly },
          ],
        }),
      ]);
      expect(
        r.commandsFor("contextMenu", ctx()).map((m) => m.command.id),
      ).toEqual(["explicit"]);
      expect(
        r
          .commandsFor("contextMenu", ctx({ selectionCount: 1 }))
          .map((m) => m.command.id),
      ).toEqual(["explicit", "sel"]);
    });
  });
});
