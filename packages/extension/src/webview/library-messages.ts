/**
 * Shared, node-safe wire types for the library browser: the class-info payload
 * plus the request / response messages the `WebviewLibraryDataSource` bridge and
 * both webview protocols compose from, so they can't drift. Kept free of any
 * `@dicode/diagram-ui` import (which pulls in DOM types) so the CommonJS
 * extension host can consume them.
 */

/**
 * Wire-format mirror of diagram-ui's `LibraryClassRestriction`. The webview side
 * consumes diagram-ui's own `LibraryClassInfo`; the shapes are structurally
 * identical so assignment is implicit.
 */
export type LibraryClassRestriction =
  | "package"
  | "model"
  | "block"
  | "class"
  | "connector"
  | "expandable connector"
  | "record"
  | "function"
  | "type"
  | "operator"
  | "operator function"
  | "operator record"
  | "unknown";

export interface LibraryClassInfo {
  qualified: string;
  restriction: LibraryClassRestriction;
}

/** The three request messages the bridge posts to the host. Both webview
 *  protocols include these members, so either entry's `postMessage` accepts a
 *  poster typed against this union. */
export type LibraryRequestMessage =
  | { type: "libraryListChildren"; requestId: string; parent: string | null }
  | { type: "librarySearch"; requestId: string; query: string }
  | { type: "libraryIcon"; requestId: string; className: string }
  // The webview no longer wants `requestId`'s result. OMC serializes every
  // call, so abandoning a superseded search's queued lookups is the difference
  // between the channel being idle and being busy on nothing.
  | { type: "libraryCancel"; requestId: string };

/** Response payload for `libraryChildren` / `librarySearchResult`. */
export interface LibraryItemsResponse {
  requestId: string;
  items?: LibraryClassInfo[];
  error?: string;
}

/** Response payload for `libraryIconResult`. */
export interface LibraryIconResponse {
  requestId: string;
  svg?: string;
  error?: string;
}
