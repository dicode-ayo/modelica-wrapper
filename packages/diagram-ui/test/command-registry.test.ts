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
});
