import type { DiagramLayout } from "@dicode/omc-client";

import type { ContextKeys } from "../interaction/context-keys.js";
import {
  applyDelete,
  applyFlip,
  applyRotate,
  applyShapeSmoothToggle,
  applyShapeVertexDelete,
} from "../interaction/layout-ops.js";
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
  | "diagram.toggleSmooth";

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
      const { layout, contextVertex: v } = target;
      if (!layout || !v) {
        return;
      }
      const next = applyShapeVertexDelete(layout, v.key, v.index);
      if (next !== layout) {
        target.commitLayout(next);
      }
    },
  },
  {
    id: "diagram.toggleSmooth",
    title: "Smooth (Bezier)",
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
]);
