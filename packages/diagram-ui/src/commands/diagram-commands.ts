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
  zOrderTarget,
  type ZOrderMove,
} from "../interaction/layout-ops.js";
import { selectAllKeys } from "../interaction/selection-ops.js";
import {
  formatShapeKey,
  parseKey,
  vertexShapeKey,
} from "../interaction/entity-keys.js";
import type {
  Command,
  CommandPlacement,
  CommandTarget,
  GoToSourceRequest,
} from "./command.js";
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

/**
 * Source-navigation ops sit in their own separated group. Group tokens
 * participate in the registry's alphabetical group sort, so this name
 * places the group between `edit` and `order` — the menu sequence is
 * pinned in `command-menu-items.test.ts`.
 */
const navigateMenu = (order: number): CommandPlacement => ({
  surface: "contextMenu",
  group: "navigate",
  order,
});

/**
 * The source a "Go to Definition" on the current selection opens, or `null`
 * when nothing resolves (so the command is not offered): a selected
 * component / standalone connector opens its TYPE's class, a connection its
 * `connect(...)` equation, and an empty selection (bare canvas) the host
 * class itself. Instance `source` IS the type's location — the producer
 * carries the declaration separately as `declarationSource`.
 */
export function resolveDefinitionSource(
  layout: DiagramLayout | null,
  selectedKeys: ReadonlySet<string>,
): GoToSourceRequest | null {
  if (!layout) return null;
  if (selectedKeys.size === 0) {
    return { source: layout.source, fallbackClassName: layout.className };
  }
  const parsed = soleSelectedKey(selectedKeys);
  if (!parsed) return null;
  switch (parsed.kind) {
    case "component": {
      const comp = layout.components[parsed.nodeId];
      if (comp?.source === undefined) return null;
      return { source: comp.source, fallbackClassName: comp.classRef };
    }
    case "connector": {
      // Only standalone connectors: a sub-component's port is the
      // component's business, and the component itself is selectable.
      if (parsed.componentName !== null) return null;
      const conn = layout.connectors[parsed.portName];
      if (conn?.source === undefined) return null;
      return { source: conn.source, fallbackClassName: conn.classRef };
    }
    case "edge": {
      const connection = layout.connections[parsed.connIndex];
      if (connection?.source === undefined) return null;
      // The connect() equation lives in the host class.
      return { source: connection.source, fallbackClassName: layout.className };
    }
    default:
      return null;
  }
}

/**
 * The source a "Go to Declaration" on the current selection opens — the
 * selected instance's own declaration in the host class — or `null` when
 * nothing resolves. An empty selection is definition territory: the host
 * class's declaration is its definition.
 */
export function resolveDeclarationSource(
  layout: DiagramLayout | null,
  selectedKeys: ReadonlySet<string>,
): GoToSourceRequest | null {
  if (!layout) return null;
  const parsed = soleSelectedKey(selectedKeys);
  if (!parsed) return null;
  const instance =
    parsed.kind === "component"
      ? layout.components[parsed.nodeId]
      : parsed.kind === "connector" && parsed.componentName === null
        ? layout.connectors[parsed.portName]
        : undefined;
  if (instance?.declarationSource === undefined) return null;
  return {
    source: instance.declarationSource,
    fallbackClassName: layout.className,
  };
}

/** The parsed sole selected key, or `null` for any other selection size. */
function soleSelectedKey(
  selectedKeys: ReadonlySet<string>,
): ReturnType<typeof parseKey> {
  if (selectedKeys.size !== 1) return null;
  const key = [...selectedKeys][0];
  return key === undefined ? null : parseKey(key);
}

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
    // menu: with nothing selected a right-click on bare canvas offers only
    // navigation, and with a selection Select All is noise.
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
    id: "diagram.goToDefinition",
    title: "Go to Definition",
    category: "Navigate",
    // Navigation only reads sources, so readonly classes keep it. The env
    // key already encodes what the selection (or bare canvas) resolves —
    // nothing is offered where nothing would open.
    when: (ctx) => ctx.hasDefinitionSource,
    placements: [navigateMenu(0)],
    run: (target) => {
      const request = resolveDefinitionSource(
        target.layout,
        target.selectedKeys,
      );
      if (request === null) return;
      target.requestGoToSource?.(request);
    },
  },
  {
    id: "diagram.goToDeclaration",
    title: "Go to Declaration",
    category: "Navigate",
    when: (ctx) => ctx.hasDeclarationSource,
    placements: [navigateMenu(1)],
    run: (target) => {
      const request = resolveDeclarationSource(
        target.layout,
        target.selectedKeys,
      );
      if (request === null) return;
      target.requestGoToSource?.(request);
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
  ["F12", "diagram.goToDefinition"],
  ["shift+?", "diagram.showKeymapHelp"],
]);
