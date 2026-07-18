import { describe, expect, it } from "vitest";

import { chordFromEvent } from "../src/commands/keymap.js";
import { DEFAULT_KEYMAP } from "../src/commands/diagram-commands.js";

const ev = (init: KeyboardEventInit): KeyboardEvent =>
  new KeyboardEvent("keydown", init);

describe("chordFromEvent", () => {
  it("lower-cases single-character keys so Shift+R shares a base with r", () => {
    expect(chordFromEvent(ev({ key: "R" }))).toBe("r");
    expect(chordFromEvent(ev({ key: "R", shiftKey: true }))).toBe("shift+r");
  });

  it("keeps named keys verbatim", () => {
    expect(chordFromEvent(ev({ key: "Delete" }))).toBe("Delete");
    expect(chordFromEvent(ev({ key: "Backspace" }))).toBe("Backspace");
  });

  it("orders modifiers ctrl+meta+alt+shift", () => {
    expect(
      chordFromEvent(
        ev({
          key: "a",
          ctrlKey: true,
          metaKey: true,
          altKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe("ctrl+meta+alt+shift+a");
  });
});

describe("DEFAULT_KEYMAP", () => {
  it("binds the shipped diagram shortcuts to command ids", () => {
    expect(DEFAULT_KEYMAP.get("Delete")).toBe("diagram.delete");
    expect(DEFAULT_KEYMAP.get("Backspace")).toBe("diagram.delete");
    expect(DEFAULT_KEYMAP.get("r")).toBe("diagram.rotateCw");
    expect(DEFAULT_KEYMAP.get("shift+r")).toBe("diagram.rotateCcw");
    expect(DEFAULT_KEYMAP.get("f")).toBe("diagram.flipHorizontal");
    expect(DEFAULT_KEYMAP.get("shift+f")).toBe("diagram.flipVertical");
    expect(DEFAULT_KEYMAP.get("shift+?")).toBe("diagram.showKeymapHelp");
  });
});
