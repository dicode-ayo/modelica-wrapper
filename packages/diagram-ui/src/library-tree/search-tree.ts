/**
 * Turn a flat `searchAll` result list into a filtered, fully-expanded tree.
 *
 * Qualified names already encode the full path (`Modelica.Blocks.Math.Gain`),
 * so the hierarchy is derived entirely from the results — no extra backend
 * calls. Every path prefix becomes a node; a node is a *match* when its path
 * equals one of the results (and carries that result's restriction), otherwise
 * it's an intermediate ancestor package that only exists because a match sits
 * below it. Depth-first, alphabetically ordered, the result flattens straight
 * into the same indented-row shape the lazy tree renders.
 */

import type {
  LibraryClassInfo,
  LibraryClassRestriction,
} from "./library-types.js";

export interface SearchTreeRow {
  /** Fully-qualified path of this node. */
  qualified: string;
  /** Last path segment, shown in the row. */
  label: string;
  /** Indent depth (0-based). */
  level: number;
  /** The match's restriction, or `"package"` for a pure ancestor. */
  restriction: LibraryClassRestriction;
  /** Whether this node is an actual search result (vs. an ancestor package). */
  isMatch: boolean;
  /** Whether this node has descendants (drives ancestor chevron vs. leaf dot). */
  hasChildren: boolean;
}

interface TreeNode {
  readonly children: Map<string, TreeNode>;
}

/**
 * Build the flattened, depth-first row list for `results`. Children are sorted
 * alphabetically so the order is deterministic; only branches leading to a
 * match exist (that is the filtering).
 */
export function buildSearchTree(
  results: readonly LibraryClassInfo[],
): SearchTreeRow[] {
  const matchRestriction = new Map<string, LibraryClassRestriction>();
  const root: TreeNode = { children: new Map() };

  for (const { qualified, restriction } of results) {
    matchRestriction.set(qualified, restriction);
    let cursor = root;
    for (const segment of qualified.split(".")) {
      let next = cursor.children.get(segment);
      if (!next) {
        next = { children: new Map() };
        cursor.children.set(segment, next);
      }
      cursor = next;
    }
  }

  const rows: SearchTreeRow[] = [];
  const walk = (node: TreeNode, prefix: string, level: number): void => {
    const segments = [...node.children.keys()].sort((a, b) =>
      a.localeCompare(b),
    );
    for (const segment of segments) {
      const child = node.children.get(segment);
      if (!child) continue;
      const qualified = prefix ? `${prefix}.${segment}` : segment;
      rows.push({
        qualified,
        label: segment,
        level,
        restriction: matchRestriction.get(qualified) ?? "package",
        isMatch: matchRestriction.has(qualified),
        hasChildren: child.children.size > 0,
      });
      walk(child, qualified, level + 1);
    }
  };
  walk(root, "", 0);
  return rows;
}
