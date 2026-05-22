/**
 * The cascading variable picker's data model. A result's variables arrive as a
 * flat list of dotted names (from `readSimulationResultVars` at the host edge);
 * this turns them into a hierarchy the picker walks one level at a time.
 *
 * Pure: it operates on `string[]`, with no dependency on Lit, ECharts, the
 * `omc-client` contract, or VSCode — so it (and the rest of this package) can be
 * built and distributed independently of the diagram editor.
 */

/**
 * A node in the variable hierarchy. A node can be BOTH a selectable leaf (its
 * full `path` is itself a stored variable) AND have children (e.g. `a.b` exists
 * alongside `a.b.c`).
 */
export interface VarNode {
  /** Path segment (e.g. `motor`, `w`, `a[1]`). */
  name: string;
  /** Full dotted path from root to this node (e.g. `motor.w`). */
  path: string;
  /** True when `path` is itself a variable in the input list. */
  isLeaf: boolean;
  children: VarNode[];
}

/**
 * Turn a result's flat list of dotted variable names into a hierarchy for the
 * cascading picker. Names are split on `.`; array subscripts stay attached to
 * their segment (`a[1].b` → `a[1]` › `b`). Duplicates are collapsed and every
 * level is sorted.
 */
export function buildVariableTree(vars: readonly string[]): VarNode[] {
  const varSet = new Set(vars);
  const roots: VarNode[] = [];
  const byPath = new Map<string, VarNode>();

  for (const v of [...varSet].sort()) {
    if (v.length === 0) continue;
    const parts = v.split(".");
    let prefix = "";
    let siblings = roots;
    for (const name of parts) {
      prefix = prefix.length === 0 ? name : `${prefix}.${name}`;
      let node = byPath.get(prefix);
      if (!node) {
        node = { name, path: prefix, isLeaf: varSet.has(prefix), children: [] };
        byPath.set(prefix, node);
        siblings.push(node);
      }
      siblings = node.children;
    }
  }

  // A lazily-created parent of a deep var can be pushed before a shorter
  // sibling, so sort every level after the fact.
  const sortRec = (nodes: VarNode[]): void => {
    nodes.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}
