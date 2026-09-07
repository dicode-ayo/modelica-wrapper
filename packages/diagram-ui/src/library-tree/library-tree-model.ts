/**
 * Data-layer glue between the `LibraryDataSource` contract and
 * Headless Tree's `asyncDataLoaderFeature`. Free of Lit / DOM so the
 * lazy-load, node-building, and search-highlight logic can be exercised
 * with a plain mock data source.
 */

import { leafName } from "@dicode/modelica-lang-core";

import type {
  LibraryActivationView,
  LibraryDataSource,
  LibraryClassInfo,
  LibraryClassRestriction,
} from "./library-types.js";

/**
 * Synthetic root the tree hangs its top-level classes under. Headless Tree
 * never renders the root item itself, only its children, so this id is an
 * implementation detail that maps to `listChildren(null)`.
 */
export const LIBRARY_TREE_ROOT_ID = "__om_library_root__";

/** One tree node built from a `LibraryClassInfo`. */
export interface LibraryTreeNode {
  /** Fully qualified dotted name; empty for the synthetic root. */
  className: string;
  /** Trailing name segment shown as the row label. */
  label: string;
  restriction: LibraryClassRestriction;
  /**
   * Whether this node has at least one child class. `undefined` means
   * unresolved: the tree hasn't listed this node's children yet, so it's
   * shown with an optimistic chevron. Set to `false` once a `listChildren`
   * call comes back empty, collapsing the node to a leaf (see
   * `onLoadedChildren` in `library-tree.component.ts`).
   */
  hasChildren?: boolean;
}

/** Data loader shape consumed by Headless Tree's `asyncDataLoaderFeature`. */
export interface LibraryDataLoader {
  getItem(itemId: string): LibraryTreeNode;
  getChildrenWithData(
    itemId: string,
  ): Promise<Array<{ id: string; data: LibraryTreeNode }>>;
}

/**
 * A node is expandable until proven otherwise: OMEdit's Libraries Browser
 * drives its expand arrow off containment, not restriction, so a `model` or
 * `record` with nested classes expands exactly like a `package`. `hasChildren`
 * starts unresolved (optimistic chevron) and only flips to `false` once the
 * node's own `listChildren` call comes back empty.
 */
export function isExpandable(
  node: Pick<LibraryTreeNode, "hasChildren">,
): boolean {
  return node.hasChildren !== false;
}

/**
 * The editor surface activating a row (double-click / Enter) routes to, by
 * restriction. Every restriction routes somewhere — activation never refuses a
 * row:
 * - `model` / `block` / `class`: diagram view.
 * - `connector` / `expandable connector`: diagram view too — MSL connectors
 *   declare both Icon and Diagram layers, and OMEdit opens them the same way.
 * - `package`: documentation view. Opening a package as a diagram wedges the
 *   view, so a package never routes there.
 * - everything else (`record`, `type`, `function`, the `operator` kinds,
 *   `unknown`): source view — always legible, even with no graphical layer.
 */
export function activationViewFor(
  r: LibraryClassRestriction,
): LibraryActivationView {
  switch (r) {
    case "model":
    case "block":
    case "class":
    case "connector":
    case "expandable connector":
      return "diagram";
    case "package":
      return "documentation";
    default:
      return "source";
  }
}

/**
 * Restrictions a diagram can hold as a component. Mirrors what OMEdit accepts
 * on a drop (`GraphicsView::addComponent`); OMC itself validates nothing and
 * will write a package in as a component if asked. Gates drag and placement.
 */
export function isPlaceableRestriction(r: LibraryClassRestriction): boolean {
  return (
    r === "model" ||
    r === "block" ||
    r === "class" ||
    r === "connector" ||
    r === "expandable connector" ||
    r === "record"
  );
}

/**
 * Trailing dotted segment of `qualified`, falling back to the whole name.
 * Quote-aware: a segment may itself be a quoted identifier containing a dot
 * (e.g. `Pkg.'a.b'`), so this doesn't split inside the quotes.
 */
export function leafLabel(qualified: string): string {
  return leafName(qualified);
}

export function nodeFromInfo(info: LibraryClassInfo): LibraryTreeNode {
  return {
    className: info.qualified,
    label: leafLabel(info.qualified),
    restriction: info.restriction,
  };
}

export function rootNode(): LibraryTreeNode {
  return { className: "", label: "", restriction: "package" };
}

/**
 * Resolve a child row's fully qualified id. A data source may return either
 * fully qualified names or bare trailing segments; the latter are prefixed
 * with the parent path.
 */
function childId(parentId: string | null, info: LibraryClassInfo): string {
  if (parentId === null) return info.qualified;
  return info.qualified.includes(".")
    ? info.qualified
    : `${parentId}.${info.qualified}`;
}

/** Outcome of the root (`listChildren(null)`) load, reported to `onRootLoad`. */
export type LibraryRootLoad =
  { ok: true; empty: boolean } | { ok: false; error: string };

/**
 * Build the Headless Tree data loader over a `LibraryDataSource`.
 * `getChildrenWithData` carries the `LibraryClassInfo` inline so restriction
 * (and thus icon + expandability) is known without a second round trip; the
 * shared `cache` lets `getItem` resolve an already-listed node.
 *
 * `onRootLoad`, when given, fires once the top-level list resolves or rejects,
 * so an embedder can derive an empty / ready / error state from the tree's own
 * root fetch instead of issuing a second `listChildren(null)`.
 */
export function createLibraryDataLoader(
  dataSource: LibraryDataSource,
  cache: Map<string, LibraryTreeNode>,
  onRootLoad?: (result: LibraryRootLoad) => void,
): LibraryDataLoader {
  return {
    getItem(itemId) {
      if (itemId === LIBRARY_TREE_ROOT_ID) return rootNode();
      return (
        cache.get(itemId) ?? {
          className: itemId,
          label: leafLabel(itemId),
          restriction: "unknown",
        }
      );
    },
    async getChildrenWithData(itemId) {
      const isRoot = itemId === LIBRARY_TREE_ROOT_ID;
      const parent = isRoot ? null : itemId;
      let infos;
      try {
        infos = await dataSource.listChildren(parent);
      } catch (err) {
        if (isRoot && onRootLoad) {
          onRootLoad({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        throw err;
      }
      if (isRoot && onRootLoad) {
        onRootLoad({ ok: true, empty: infos.length === 0 });
      }
      return infos.map((info) => {
        const id = childId(parent, info);
        const data: LibraryTreeNode = {
          className: id,
          label: leafLabel(id),
          restriction: info.restriction,
        };
        cache.set(id, data);
        return { id, data };
      });
    },
  };
}

/** Split of a label around a case-insensitive query match. */
export interface LabelMatch {
  before: string;
  match: string;
  after: string;
}

/**
 * Locate `query` within `label` (case-insensitive) and split the label around
 * it for highlighting. Returns `null` when the query is empty or absent so the
 * caller can render the plain label.
 */
export function matchLabel(label: string, query: string): LabelMatch | null {
  if (!query) return null;
  const at = label.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return null;
  return {
    before: label.slice(0, at),
    match: label.slice(at, at + query.length),
    after: label.slice(at + query.length),
  };
}
