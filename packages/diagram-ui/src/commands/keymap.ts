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

const MODIFIER_LABELS: Readonly<Record<string, string>> = {
  ctrl: "Ctrl",
  meta: "Cmd",
  alt: "Alt",
  shift: "Shift",
};

/** Render a {@link KeyChord} for display, e.g. `"shift+r"` -> `"Shift+R"`. */
export function formatChord(chord: KeyChord): string {
  return chord
    .split("+")
    .map(
      (part) =>
        MODIFIER_LABELS[part] ??
        (part.length === 1 ? part.toUpperCase() : part),
    )
    .join("+");
}
