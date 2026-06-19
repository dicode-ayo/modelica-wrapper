/**
 * A normalized key chord, e.g. `"Delete"`, `"r"`, `"shift+r"`. Modifiers are
 * lower-case and ordered `ctrl+meta+alt+shift`; single-character keys are
 * lower-cased (so `Shift+R` and `r` share a base), named keys kept verbatim.
 */
export type KeyChord = string;

export function chordFromEvent(e: KeyboardEvent): KeyChord {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("ctrl");
  if (e.metaKey) parts.push("meta");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  return parts.join("+");
}

/**
 * Default chord → command-id bindings. Fixed here; user reassignment is F2b
 * (#184). Mirrors the shortcuts the diagram has always shipped.
 */
export const DEFAULT_KEYMAP: ReadonlyMap<KeyChord, string> = new Map([
  ["Delete", "diagram.delete"],
  ["Backspace", "diagram.delete"],
  ["r", "diagram.rotateCw"],
  ["shift+r", "diagram.rotateCcw"],
  ["f", "diagram.flipHorizontal"],
  ["shift+f", "diagram.flipVertical"],
]);
