export type {
  Command,
  CommandPlacement,
  CommandSurface,
  CommandTarget,
  PlacedCommand,
} from "./command.js";
export { CommandRegistry } from "./registry.js";
export { chordFromEvent, formatChord, type KeyChord } from "./keymap.js";
export {
  DIAGRAM_COMMANDS,
  DEFAULT_KEYMAP,
  type DiagramCommandId,
} from "./diagram-commands.js";
