/**
 * Message protocol between the extension host (Node) and the library sidebar
 * webview view (`library-view-entry.ts`). All messages are JSON-serialisable.
 *
 * The library list / search / icon request+response messages are structurally
 * identical to the diagram webview's (see {@link ../diagram/library-source} and
 * {@link ./library-data-source}); the shared `WebviewLibraryDataSource` bridge
 * drives both. This view adds the sidebar-only affordances: opening a diagram
 * on select, the Load-Library empty-state action, the host-mediated placement
 * gesture, and a host-driven reload.
 */

import type { LibraryClassInfo } from "./protocol.js";

export type ExtensionToLibraryView =
  | {
      type: "libraryChildren";
      requestId: string;
      items?: LibraryClassInfo[];
      error?: string;
    }
  | {
      type: "librarySearchResult";
      requestId: string;
      items?: LibraryClassInfo[];
      error?: string;
    }
  | {
      type: "libraryIconResult";
      requestId: string;
      svg?: string;
      error?: string;
    }
  | {
      // Re-fetch after a mutation (Load Library / Create Class / auto-load).
      type: "reload";
    };

export type LibraryViewToExtension =
  | { type: "ready" }
  | { type: "libraryListChildren"; requestId: string; parent: string | null }
  | { type: "librarySearch"; requestId: string; query: string }
  | { type: "libraryIcon"; requestId: string; className: string }
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
