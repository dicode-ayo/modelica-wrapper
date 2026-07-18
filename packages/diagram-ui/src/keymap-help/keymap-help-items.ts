import type { CommandRegistry } from "../commands/registry.js";
import { formatChord, type KeyChord } from "../commands/keymap.js";
import type { ContextKeys } from "../interaction/context-keys.js";
import type {
  KeymapHelpGroup,
  KeymapHelpItem,
} from "./keymap-help.component.js";

/**
 * Group every command that has a bound key chord by its `category`, in
 * registry order, with each command's currently-bound chords formatted for
 * display and its `enabled` state resolved against `ctx`. Commands without a
 * binding are omitted — this is a keyboard-shortcut reference, not a full
 * command palette.
 */
export function commandsToKeymapHelpGroups<Id extends string>(
  registry: CommandRegistry<Id>,
  keymap: ReadonlyMap<KeyChord, Id>,
  ctx: ContextKeys,
): KeymapHelpGroup[] {
  const chordsById = new Map<Id, string[]>();
  for (const [chord, id] of keymap) {
    const formatted = formatChord(chord);
    const existing = chordsById.get(id);
    if (existing) {
      existing.push(formatted);
    } else {
      chordsById.set(id, [formatted]);
    }
  }

  const groups = new Map<string, KeymapHelpItem[]>();
  for (const command of registry.all()) {
    const chords = chordsById.get(command.id);
    if (!chords) {
      continue;
    }
    const item: KeymapHelpItem = {
      id: command.id,
      title: command.title,
      chords,
      enabled: registry.isEnabled(command.id, ctx),
    };
    const existing = groups.get(command.category);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(command.category, [item]);
    }
  }
  return [...groups.entries()].map(([category, items]) => ({
    category,
    items,
  }));
}
