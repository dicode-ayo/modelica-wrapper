import type { DiagramLayout } from "@dicode/omc-client";

import type { ContextKeys } from "../interaction/context-keys.js";
import {
  applyDelete,
  applyFlip,
  applyRotate,
} from "../interaction/layout-ops.js";
import type { Command, CommandTarget } from "./command.js";

const requireSelection = (ctx: ContextKeys): boolean =>
  !ctx.readonly && ctx.selectionCount > 0;

/** Run a layout op over the current selection and commit it if it changed. */
function mutate(
  target: CommandTarget,
  op: (layout: DiagramLayout, keys: ReadonlySet<string>) => DiagramLayout,
): void {
  const { layout } = target;
  if (!layout) {
    return;
  }
  const next = op(layout, target.selectedKeys);
  if (next !== layout) {
    target.commitLayout(next);
  }
}

export const DIAGRAM_COMMANDS: readonly Command[] = [
  {
    id: "diagram.delete",
    title: "Delete",
    category: "Edit",
    when: requireSelection,
    run: (target) => {
      const { layout } = target;
      if (!layout) {
        return;
      }
      const next = applyDelete(layout, target.selectedKeys);
      if (next !== layout) {
        target.commitLayout(next);
        target.setSelection([]);
      }
    },
  },
  {
    id: "diagram.rotateCw",
    title: "Rotate clockwise",
    category: "Edit",
    when: requireSelection,
    run: (target) => mutate(target, (l, k) => applyRotate(l, k, true)),
  },
  {
    id: "diagram.rotateCcw",
    title: "Rotate counterclockwise",
    category: "Edit",
    when: requireSelection,
    run: (target) => mutate(target, (l, k) => applyRotate(l, k, false)),
  },
  {
    id: "diagram.flipHorizontal",
    title: "Flip horizontal",
    category: "Edit",
    when: requireSelection,
    run: (target) => mutate(target, (l, k) => applyFlip(l, k, true)),
  },
  {
    id: "diagram.flipVertical",
    title: "Flip vertical",
    category: "Edit",
    when: requireSelection,
    run: (target) => mutate(target, (l, k) => applyFlip(l, k, false)),
  },
];
