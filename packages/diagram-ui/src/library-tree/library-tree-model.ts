/**
 * Data-layer glue between the `LibraryBrowserDataSource` contract and
 * Headless Tree's `asyncDataLoaderFeature`. Free of Lit / DOM so the
 * lazy-load, node-building, and search-highlight logic can be exercised
 * with a plain mock data source.
 */

import type {
  LibraryBrowserDataSource,
  LibraryClassInfo,
  LibraryClassRestriction,
} from "../library-browser/library-browser.component.js";

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
}

/** Data loader shape consumed by Headless Tree's `asyncDataLoaderFeature`. */
export interface LibraryDataLoader {
  getItem(itemId: string): LibraryTreeNode;
  getChildrenWithData(
    itemId: string,
  ): Promise<Array<{ id: string; data: LibraryTreeNode }>>;
}

/**
 * Tree expansion is restricted to `package` (the only Modelica restriction
 * whose primary role is to contain other classes). `unknown` is also treated
 * as expandable so a data source that hasn't resolved the kind yet doesn't
 * orphan its children.
 */
export function isExpandable(r: LibraryClassRestriction): boolean {
  return r === "package" || r === "unknown";
}

/** Trailing dotted segment of `qualified`, falling back to the whole name. */
export function leafLabel(qualified: string): string {
  return qualified.slice(qualified.lastIndexOf(".") + 1) || qualified;
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

/**
 * Build the Headless Tree data loader over a `LibraryBrowserDataSource`.
 * `getChildrenWithData` carries the `LibraryClassInfo` inline so restriction
 * (and thus icon + expandability) is known without a second round trip; the
 * shared `cache` lets `getItem` resolve an already-listed node.
 */
export function createLibraryDataLoader(
  dataSource: LibraryBrowserDataSource,
  cache: Map<string, LibraryTreeNode>,
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
      const parent = itemId === LIBRARY_TREE_ROOT_ID ? null : itemId;
      const infos = await dataSource.listChildren(parent);
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
