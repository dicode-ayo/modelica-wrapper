import type { DiagramCommandId } from "./diagram-commands.js";

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
 * A sparse overlay on top of {@link DEFAULT_KEYMAP}. A `null` value unbinds
 * the chord; any other value adds or replaces the binding.
 */
export type KeymapOverrides = ReadonlyMap<KeyChord, string | null>;

/** Merge user overrides onto a base keymap. */
export function resolveKeymap(
  base: ReadonlyMap<KeyChord, DiagramCommandId>,
  overrides: KeymapOverrides,
): ReadonlyMap<KeyChord, DiagramCommandId> {
  if (overrides.size === 0) return base;
  const merged = new Map(base);
  for (const [chord, id] of overrides) {
    if (id === null) {
      merged.delete(chord);
    } else {
      merged.set(chord, id as DiagramCommandId);
    }
  }
  return merged;
}

/** A chord that maps to two different commands across base + override. */
export interface KeymapConflict {
  chord: KeyChord;
  /** The command the override wants to assign. */
  newId: string;
  /** The command currently bound to this chord before the override. */
  existingId: DiagramCommandId;
}

/**
 * Return conflicts where an override chord is already bound to a different
 * command in the working keymap (base + prior overrides applied in iteration
 * order).
 */
export function detectConflicts(
  overrides: KeymapOverrides,
  base: ReadonlyMap<KeyChord, DiagramCommandId>,
): KeymapConflict[] {
  const result: KeymapConflict[] = [];
  const working = new Map(base);
  for (const [chord, newId] of overrides) {
    if (newId === null) {
      working.delete(chord);
      continue;
    }
    const existingId = working.get(chord);
    if (existingId !== undefined && existingId !== newId) {
      result.push({ chord, newId, existingId });
    }
    working.set(chord, newId as DiagramCommandId);
  }
  return result;
}
