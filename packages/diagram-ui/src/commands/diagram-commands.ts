import type { DiagramLayout } from "@dicode/omc-client";

import type { ContextKeys } from "../interaction/context-keys.js";
import {
  applyDelete,
  applyFlip,
  applyRotate,
  applyShapeSmoothToggle,
  applyShapeVertexDelete,
} from "../interaction/layout-ops.js";
import { parseKey, vertexShapeKey } from "../interaction/node-keys.js";
import type { Command, CommandPlacement, CommandTarget } from "./command.js";
import type { KeyChord } from "./keymap.js";

/** The ids of the built-in diagram commands; the keymap and every dispatch
 *  site are checked against this union. */
export type DiagramCommandId =
  | "diagram.delete"
  | "diagram.rotateCw"
  | "diagram.rotateCcw"
  | "diagram.flipHorizontal"
  | "diagram.flipVertical"
  | "diagram.deleteVertex"
  | "diagram.toggleSmooth"
  | "diagram.changeClass"
  | "diagram.showKeymapHelp";

const requireSelection = (ctx: ContextKeys): boolean =>
  !ctx.readonly && ctx.selectionCount > 0;

/**
 * Run a layout op over the current selection and commit it if it changed,
 * then run `afterCommit` (e.g. to clear the now-deleted selection).
 */
function mutate(
  target: CommandTarget,
  op: (layout: DiagramLayout, keys: ReadonlySet<string>) => DiagramLayout,
  afterCommit?: (target: CommandTarget) => void,
): void {
  const { layout } = target;
  if (!layout) {
    return;
  }
  const next = op(layout, target.selectedKeys);
  if (next !== layout) {
    target.commitLayout(next);
    afterCommit?.(target);
  }
}

/** Edit ops show in the right-click menu when something is selected. */
const editMenu = (order: number): CommandPlacement => ({
  surface: "contextMenu",
  group: "edit",
  order,
});

export const DIAGRAM_COMMANDS: readonly Command<DiagramCommandId>[] = [
  {
    id: "diagram.delete",
    title: "Delete",
    category: "Edit",
    when: requireSelection,
    placements: [editMenu(0)],
    run: (target) => mutate(target, applyDelete, (t) => t.setSelection([])),
  },
  {
    id: "diagram.rotateCw",
    title: "Rotate clockwise",
    category: "Edit",
    when: requireSelection,
    placements: [editMenu(1)],
    run: (target) => mutate(target, (l, k) => applyRotate(l, k, true)),
  },
  {
    id: "diagram.rotateCcw",
    title: "Rotate counterclockwise",
    category: "Edit",
    when: requireSelection,
    placements: [editMenu(2)],
    run: (target) => mutate(target, (l, k) => applyRotate(l, k, false)),
  },
  {
    id: "diagram.flipHorizontal",
    title: "Flip horizontal",
    category: "Edit",
    when: requireSelection,
    placements: [editMenu(3)],
    run: (target) => mutate(target, (l, k) => applyFlip(l, k, true)),
  },
  {
    id: "diagram.flipVertical",
    title: "Flip vertical",
    category: "Edit",
    when: requireSelection,
    placements: [editMenu(4)],
    run: (target) => mutate(target, (l, k) => applyFlip(l, k, false)),
  },
  {
    id: "diagram.deleteVertex",
    title: "Delete vertex",
    category: "Edit",
    when: (ctx) => !ctx.readonly && ctx.vertexTarget,
    placements: [editMenu(5)],
    run: (target) => {
      const { layout, contextVertex } = target;
      const vertex = contextVertex ? parseKey(contextVertex) : null;
      if (!layout || !vertex || vertex.kind !== "vertex-handle") {
        return;
      }
      const next = applyShapeVertexDelete(
        layout,
        vertexShapeKey(vertex),
        vertex.vertexIndex,
      );
      if (next !== layout) {
        target.commitLayout(next);
      }
    },
  },
  {
    id: "diagram.toggleSmooth",
    title: "Toggle smoothing",
    category: "Edit",
    when: (ctx) => !ctx.readonly && ctx.polySelection,
    placements: [editMenu(6)],
    run: (target) => {
      const key = [...target.selectedKeys][0];
      if (!target.layout || key === undefined) {
        return;
      }
      const next = applyShapeSmoothToggle(target.layout, key);
      if (next !== target.layout) {
        target.commitLayout(next);
      }
    },
  },
  {
    id: "diagram.changeClass",
    title: "Change class…",
    category: "Edit",
    when: (ctx) =>
      !ctx.readonly &&
      ctx.selectionCount === 1 &&
      ctx.selectionKind === "component",
    placements: [editMenu(7)],
    run: (target) => {
      const key = [...target.selectedKeys][0];
      if (!target.layout || key === undefined) return;
      const parsed = parseKey(key);
      if (!parsed || parsed.kind !== "component") return;
      const comp = target.layout.components[parsed.nodeId];
      if (comp === undefined) return;
      target.requestClassChange?.(parsed.nodeId, comp.classRef);
    },
  },
  {
    id: "diagram.showKeymapHelp",
    title: "Show keyboard shortcuts",
    category: "Help",
    run: (target) => target.showKeymapHelp?.(),
  },
];

/**
 * Default chord → command-id bindings for the diagram. Values are checked
 * against {@link DiagramCommandId}, so a binding can't point at a command that
 * doesn't exist. Fixed here; user reassignment is F2b (#184).
 */
export const DEFAULT_KEYMAP: ReadonlyMap<KeyChord, DiagramCommandId> = new Map([
  ["Delete", "diagram.delete"],
  ["Backspace", "diagram.delete"],
  ["r", "diagram.rotateCw"],
  ["shift+r", "diagram.rotateCcw"],
  ["f", "diagram.flipHorizontal"],
  ["shift+f", "diagram.flipVertical"],
  ["shift+?", "diagram.showKeymapHelp"],
]);
