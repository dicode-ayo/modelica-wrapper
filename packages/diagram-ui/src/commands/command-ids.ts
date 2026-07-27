/**
 * The ids of the built-in diagram commands; the keymap and every dispatch site
 * are checked against this union.
 *
 * Kept in its own import-free module and published as the
 * `@dicode/diagram-ui/command-ids` subpath so the extension host can share the
 * union instead of mirroring it. The package root pulls in the Lit and Pixi
 * component tree, whose types need the DOM lib — importing it from the host's
 * Node program fails on `window` / `HTMLElement` / `ResizeObserver`, even for a
 * type-only import. Add nothing to this file that imports anything.
 */
export type DiagramCommandId =
  | "diagram.delete"
  | "diagram.rotateCw"
  | "diagram.rotateCcw"
  | "diagram.flipHorizontal"
  | "diagram.flipVertical"
  | "diagram.deleteVertex"
  | "diagram.toggleSmooth"
  | "diagram.bringToFront"
  | "diagram.bringForward"
  | "diagram.sendBackward"
  | "diagram.sendToBack"
  | "diagram.changeClass"
  | "diagram.copy"
  | "diagram.paste"
  | "diagram.showKeymapHelp";
