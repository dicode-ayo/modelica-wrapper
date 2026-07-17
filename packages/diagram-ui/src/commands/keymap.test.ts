import { describe, expect, it } from "vitest";
import { DEFAULT_KEYMAP } from "./diagram-commands.js";
import { chordFromEvent, formatChord } from "./keymap.js";

const chord = (init: KeyboardEventInit): string =>
  chordFromEvent(new KeyboardEvent("keydown", init));

describe("chordFromEvent", () => {
  it("lower-cases single-character keys so Shift+R and r share a base", () => {
    expect(chord({ key: "R" })).toBe("r");
    expect(chord({ key: "R", shiftKey: true })).toBe("shift+r");
  });

  it("keeps named keys verbatim", () => {
    expect(chord({ key: "Delete" })).toBe("Delete");
    expect(chord({ key: "Backspace" })).toBe("Backspace");
  });

  it("orders modifiers ctrl+meta+alt+shift", () => {
    expect(
      chord({
        key: "a",
        ctrlKey: true,
        metaKey: true,
        altKey: true,
        shiftKey: true,
      }),
    ).toBe("ctrl+meta+alt+shift+a");
  });

  it("produces chords that index the default keymap", () => {
    expect(DEFAULT_KEYMAP.get(chord({ key: "r" }))).toBe("diagram.rotateCw");
    expect(DEFAULT_KEYMAP.get(chord({ key: "F", shiftKey: true }))).toBe(
      "diagram.flipVertical",
    );
  });
});

describe("formatChord", () => {
  it("title-cases modifiers and upper-cases a single-character base key", () => {
    expect(formatChord("shift+r")).toBe("Shift+R");
    expect(formatChord("r")).toBe("R");
  });

  it("keeps named keys verbatim", () => {
    expect(formatChord("Delete")).toBe("Delete");
    expect(formatChord("Backspace")).toBe("Backspace");
  });

  it("orders and labels every modifier", () => {
    expect(formatChord("ctrl+meta+alt+shift+a")).toBe("Ctrl+Cmd+Alt+Shift+A");
  });
});
