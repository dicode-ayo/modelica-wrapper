import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Command {
  command: string;
}
interface Keybinding {
  command: string;
  key: string;
  when?: string;
}

const manifest = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as {
  contributes: { commands: Command[]; keybindings: Keybinding[] };
};

const commands = manifest.contributes.commands;
const keybindings = manifest.contributes.keybindings;

/** VSCode command id → expected default chord, mirroring `DEFAULT_KEYMAP`. */
const SELECTION_KEYS: Record<string, readonly string[]> = {
  "modelica.diagram.delete": ["delete", "backspace"],
  "modelica.diagram.rotateCw": ["r"],
  "modelica.diagram.rotateCcw": ["shift+r"],
  "modelica.diagram.flipHorizontal": ["f"],
  "modelica.diagram.flipVertical": ["shift+f"],
};

describe("diagram selection keybindings", () => {
  it("declares every selection command in contributes.commands", () => {
    const declared = new Set(commands.map((c) => c.command));
    for (const id of Object.keys(SELECTION_KEYS)) {
      expect(declared).toContain(id);
    }
  });

  it("binds each selection command to its default chord(s)", () => {
    for (const [id, keys] of Object.entries(SELECTION_KEYS)) {
      const bound = keybindings
        .filter((k) => k.command === id)
        .map((k) => k.key);
      expect(bound.sort()).toEqual([...keys].sort());
    }
  });

  it("guards single-letter shortcuts so they don't fire while typing", () => {
    // `!modelicaDiagramInputFocus` covers inputs inside the webview (the
    // parameter modal); `!inputFocus` covers native VSCode inputs (e.g. the
    // change-class quick pick). Without both, Backspace / r / f would act on
    // the diagram while the user types.
    for (const id of Object.keys(SELECTION_KEYS)) {
      for (const binding of keybindings.filter((k) => k.command === id)) {
        expect(binding.when).toBe(
          "activeWebviewPanelId == modelicaDiagram && !modelicaDiagramInputFocus && !inputFocus",
        );
      }
    }
  });

  it("has no keybinding pointing at an undeclared command", () => {
    const declared = new Set(commands.map((c) => c.command));
    for (const binding of keybindings) {
      expect(declared).toContain(binding.command);
    }
  });
});
