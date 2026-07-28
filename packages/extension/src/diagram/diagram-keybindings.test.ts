import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Command {
  command: string;
}
interface Keybinding {
  command: string;
  key: string;
  mac?: string;
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
const KEYBOUND_KEYS: Record<string, readonly string[]> = {
  "modelica.diagram.selectAll": ["ctrl+a"],
  "modelica.diagram.delete": ["delete", "backspace"],
  "modelica.diagram.rotateCw": ["r"],
  "modelica.diagram.rotateCcw": ["shift+r"],
  "modelica.diagram.flipHorizontal": ["f"],
  "modelica.diagram.flipVertical": ["shift+f"],
  "modelica.diagram.copy": ["ctrl+c"],
  "modelica.diagram.paste": ["ctrl+v"],
  "modelica.diagram.bringForward": ["ctrl+]"],
  "modelica.diagram.sendBackward": ["ctrl+["],
  "modelica.diagram.bringToFront": ["ctrl+shift+]"],
  "modelica.diagram.sendToBack": ["ctrl+shift+["],
  "modelica.diagram.showKeymapHelp": ["shift+/"],
};

/** Commands whose binding carries a `mac` override alongside `key`. */
const MAC_OVERRIDES: Record<string, string> = {
  "modelica.diagram.selectAll": "cmd+a",
  "modelica.diagram.copy": "cmd+c",
  "modelica.diagram.paste": "cmd+v",
  "modelica.diagram.bringForward": "cmd+]",
  "modelica.diagram.sendBackward": "cmd+[",
  "modelica.diagram.bringToFront": "cmd+shift+]",
  "modelica.diagram.sendToBack": "cmd+shift+[",
};

describe("diagram keybindings", () => {
  it("declares every keybound command in contributes.commands", () => {
    const declared = new Set(commands.map((c) => c.command));
    for (const id of Object.keys(KEYBOUND_KEYS)) {
      expect(declared).toContain(id);
    }
  });

  it("binds each command to its default chord(s)", () => {
    for (const [id, keys] of Object.entries(KEYBOUND_KEYS)) {
      const bound = keybindings
        .filter((k) => k.command === id)
        .map((k) => k.key);
      expect(bound.sort()).toEqual([...keys].sort());
    }
  });

  it("gives the clipboard chords their Cmd equivalent on macOS", () => {
    for (const [id, mac] of Object.entries(MAC_OVERRIDES)) {
      const bound = keybindings.filter((k) => k.command === id);
      expect(bound.map((k) => k.mac)).toEqual([mac]);
    }
  });

  it("guards single-letter shortcuts so they don't fire while typing", () => {
    // `!modelicaDiagramInputFocus` covers inputs inside the webview (the
    // parameter modal); `!inputFocus` covers native VSCode inputs (e.g. the
    // change-class quick pick). Without both, Backspace / r / f would act on
    // the diagram while the user types.
    for (const id of Object.keys(KEYBOUND_KEYS)) {
      for (const binding of keybindings.filter((k) => k.command === id)) {
        expect(binding.when).toBe(
          "(activeCustomEditorId == modelica.diagram || activeCustomEditorId == modelica.icon) && !modelicaDiagramInputFocus && !inputFocus",
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
