/**
 * Message protocol between the extension host (Node) and the library sidebar
 * webview view (`library-view-entry.ts`). All messages are JSON-serializable.
 *
 * The library list / search / icon request+response payloads are shared with
 * the `WebviewLibraryDataSource` bridge — composed from its exported types so
 * bridge and protocol can't drift. This view adds the sidebar-only affordances:
 * opening a diagram on select, the Load-Library empty-state action, the
 * host-mediated placement gesture, a host-driven reload, and a row's
 * context-menu action — a webview view has no native per-item context menu, so
 * the target row's `LibraryNode` fields travel over this message instead.
 */

import type {
  LibraryClassRestriction,
  LibraryIconResponse,
  LibraryItemsResponse,
  LibraryRequestMessage,
} from "./library-messages.js";
import type { LibraryNode } from "../commands/context.js";

export type ExtensionToLibraryView =
  | ({ type: "libraryChildren" } & LibraryItemsResponse)
  | ({ type: "librarySearchResult" } & LibraryItemsResponse)
  | ({ type: "libraryIconResult" } & LibraryIconResponse)
  | {
      // Re-fetch after a mutation (Load Library / Create Class / auto-load).
      type: "reload";
    };

export type LibraryViewToExtension =
  | LibraryRequestMessage
  | {
      // A class row was activated (click / Enter) — open its diagram.
      type: "openDiagram";
      className: string;
    }
  | {
      // A class row was pressed and dragged toward the canvas. The host relays
      // this to the active diagram webview, which drives its own ghost.
      type: "placementStart";
      className: string;
    }
  | { type: "placementCancel" }
  | {
      // The empty-state "Load Library" affordance was pressed.
      type: "loadLibrary";
    }
  | {
      // A row's context-menu action was chosen; relay to the matching command
      // with the target row as its `LibraryNode` argument.
      type: "libraryNodeCommand";
      command: "viewSource" | "createClass" | "savePackage";
      node: Pick<LibraryNode, "qualifiedName" | "displayName"> & {
        restriction: LibraryClassRestriction;
      };
    };
