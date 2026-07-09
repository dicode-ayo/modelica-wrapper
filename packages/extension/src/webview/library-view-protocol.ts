/**
 * Message protocol between the extension host (Node) and the library sidebar
 * webview view (`library-view-entry.ts`). All messages are JSON-serializable.
 *
 * The library list / search / icon request+response payloads are shared with
 * the `WebviewLibraryDataSource` bridge — composed from its exported types so
 * bridge and protocol can't drift. This view adds the sidebar-only affordances:
 * opening a diagram on select, the Load-Library empty-state action, the
 * host-mediated placement gesture, and a host-driven reload.
 */

import type {
  LibraryIconResponse,
  LibraryItemsResponse,
  LibraryRequestMessage,
} from "./library-messages.js";

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
    };
