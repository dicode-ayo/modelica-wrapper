export type {
  Command,
  CommandPlacement,
  CommandSurface,
  CommandTarget,
  GoToSourceRequest,
  PlacedCommand,
} from "./command.js";
export { CommandRegistry } from "./registry.js";
export { chordFromEvent, formatChord, type KeyChord } from "./keymap.js";
export {
  DIAGRAM_COMMANDS,
  DEFAULT_KEYMAP,
  resolveDeclarationSource,
  resolveDefinitionSource,
  type DiagramCommandId,
} from "./diagram-commands.js";
