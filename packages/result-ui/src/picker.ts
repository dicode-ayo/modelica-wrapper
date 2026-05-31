/**
 * Pure logic for the cascading variable picker — split out of
 * `<om-add-trace-row>` so it's unit-testable without a DOM (the `<select>`
 * rendering is a thin shell exercised in Storybook). Operates on the
 * {@link VarNode} tree from {@link buildVariableTree} plus the chosen path.
 */

import type { VarNode } from "./var-tree.js";

export interface CascadeLevel {
  level: number;
  /** Selectable nodes at this level. */
  opts: VarNode[];
  /** Currently-chosen segment name at this level (`""` if none). */
  current: string;
}

/** Selectable nodes at cascade `level` given the chosen path (level 0 = roots).
 * Returns `[]` if the path doesn't resolve. */
export function optionsAt(
  tree: readonly VarNode[],
  selections: readonly string[],
  level: number,
): VarNode[] {
  let nodes: readonly VarNode[] = tree;
  for (let i = 0; i < level; i++) {
    const next = nodes.find((n) => n.name === selections[i]);
    if (!next) return [];
    nodes = next.children;
  }
  return [...nodes];
}

/** One entry per chosen segment plus the next open level, stopping when a level
 * has no children. Drives the row of `<select>`s. */
export function cascadeLevels(
  tree: readonly VarNode[],
  selections: readonly string[],
): CascadeLevel[] {
  const out: CascadeLevel[] = [];
  for (let level = 0; level <= selections.length; level++) {
    const opts = optionsAt(tree, selections, level);
    if (opts.length === 0) break;
    out.push({ level, opts, current: selections[level] ?? "" });
  }
  return out;
}

/** The node the current path points at (or `undefined`). Its `isLeaf` decides
 * whether "Add" is enabled and its `path` is the variable to add. */
export function selectedNode(
  tree: readonly VarNode[],
  selections: readonly string[],
): VarNode | undefined {
  if (selections.length === 0) return undefined;
  const last = selections.length - 1;
  return optionsAt(tree, selections, last).find(
    (n) => n.name === selections[last],
  );
}

/** Apply a `<select>` change at `level`: truncate to that level and append the
 * chosen value (or just truncate when cleared). */
export function withSelection(
  selections: readonly string[],
  level: number,
  value: string,
): string[] {
  return value
    ? [...selections.slice(0, level), value]
    : selections.slice(0, level);
}
