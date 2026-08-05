import type { DiagramLayout } from "@dicode/omc-client";

import type { ContextKeys } from "../interaction/context-keys.js";
import {
  applyDelete,
  applyFlip,
  applyRotate,
  applyShapeReorder,
  applyShapeSmoothToggle,
  applyShapeVertexDelete,
  ownShapeCount,
  selectAllKeys,
  zOrderTarget,
  type ZOrderMove,
} from "../interaction/layout-ops.js";
import {
  formatShapeKey,
  parseKey,
  vertexShapeKey,
} from "../interaction/entity-keys.js";
import type { Command, CommandPlacement, CommandTarget } from "./command.js";
import type { DiagramCommandId } from "./command-ids.js";
import type { KeyChord } from "./keymap.js";

export type { DiagramCommandId } from "./command-ids.js";

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

/** Clipboard ops sit in their own separated group above the edit ops. */
const clipboardMenu = (order: number): CommandPlacement => ({
  surface: "contextMenu",
  group: "clipboard",
  order,
});

/** Z-order ops get their own separated group, as OMEdit's "Order" submenu. */
const orderMenu = (order: number): CommandPlacement => ({
  surface: "contextMenu",
  group: "order",
  order,
});

/** Reordering is per-shape: a multi-shape selection has no single destination. */
const requireOneShape = (ctx: ContextKeys): boolean =>
  !ctx.readonly && ctx.selectionKind === "shape" && ctx.selectionCount === 1;

/**
 * Move the selected shape through the layer's paint order and keep it
 * selected. Shape keys are positional, so the selection has to be re-keyed to
 * the destination index or it would follow whichever shape slid into the old
 * slot.
 */
function reorder(target: CommandTarget, move: ZOrderMove): void {
  const { layout } = target;
  const key = [...target.selectedKeys][0];
  if (!layout || key === undefined) {
    return;
  }
  const parsed = parseKey(key);
  if (!parsed || parsed.kind !== "shape") {
    return;
  }
  const to = zOrderTarget(move, parsed.index, ownShapeCount(layout));
  if (to === null) {
    return;
  }
  const next = applyShapeReorder(layout, parsed.index, to);
  if (next !== layout) {
    target.commitLayout(next);
    target.setSelection([formatShapeKey(parsed.shapeKind, to)]);
  }
}

export const DIAGRAM_COMMANDS: readonly Command<DiagramCommandId>[] = [
  {
    id: "diagram.selectAll",
    title: "Select All",
    category: "Edit",
    // Read-only classes select fine; only the edits are refused. No context
    // menu: the menu is empty with nothing selected, and a Select All entry
    // would be the one thing that made a right-click on bare canvas open one.
    when: (ctx) => ctx.mode !== "draw",
    run: (target) => {
      const { layout } = target;
      if (!layout) return;
      target.setSelection(selectAllKeys(layout));
    },
  },
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
    id: "diagram.bringToFront",
    title: "Bring to Front",
    category: "Order",
    when: requireOneShape,
    placements: [orderMenu(0)],
    run: (target) => reorder(target, "front"),
  },
  {
    id: "diagram.bringForward",
    title: "Bring Forward",
    category: "Order",
    when: requireOneShape,
    placements: [orderMenu(1)],
    run: (target) => reorder(target, "forward"),
  },
  {
    id: "diagram.sendBackward",
    title: "Send Backward",
    category: "Order",
    when: requireOneShape,
    placements: [orderMenu(2)],
    run: (target) => reorder(target, "backward"),
  },
  {
    id: "diagram.sendToBack",
    title: "Send to Back",
    category: "Order",
    when: requireOneShape,
    placements: [orderMenu(3)],
    run: (target) => reorder(target, "back"),
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
    id: "diagram.copy",
    title: "Copy",
    category: "Edit",
    // Copying reads the class; only paste writes one.
    when: (ctx) => ctx.selectionCount > 0,
    placements: [clipboardMenu(0)],
    run: (target) => target.requestClipboard?.("copy"),
  },
  {
    id: "diagram.paste",
    title: "Paste",
    category: "Edit",
    when: (ctx) => !ctx.readonly && ctx.hasClipboard,
    placements: [clipboardMenu(1)],
    run: (target) => target.requestClipboard?.("paste"),
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
  ["ctrl+c", "diagram.copy"],
  ["ctrl+v", "diagram.paste"],
  // `chordFromEvent` reads `e.key`, which carries the shifted glyph: pressing
  // Ctrl+Shift+] reports `}`, not `]`. The VSCode manifest binds the physical
  // key (`ctrl+shift+]`), so the two spellings differ on purpose — as they
  // already do for `shift+?` / `shift+/`.
  ["ctrl+a", "diagram.selectAll"],
  ["ctrl+]", "diagram.bringForward"],
  ["ctrl+[", "diagram.sendBackward"],
  ["ctrl+shift+}", "diagram.bringToFront"],
  ["ctrl+shift+{", "diagram.sendToBack"],
  ["shift+?", "diagram.showKeymapHelp"],
]);
