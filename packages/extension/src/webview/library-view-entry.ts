/**
 * Browser entry for the library sidebar webview view. Bundled by esbuild into
 * `out/library-view.js` and loaded inside the sidebar's webview iframe by
 * `library/library-webview-provider.ts`.
 *
 * Renders a full-height `<om-library-tree>` fed by the shared
 * `WebviewLibraryDataSource` bridge. The tree's single root fetch drives the
 * empty / error chrome (via `om-library-root-loaded`) — a webview view gets no
 * `viewsWelcome`, and a second probe fetch would race the tree's own on the one
 * OMC socket. A row double-click opens the class's diagram; a row press-drag
 * begins host-mediated placement onto the diagram canvas (HTML5 drag can't
 * cross the webview iframe, so only the class name is relayed — the diagram
 * draws its own ghost). A row right-click opens `<om-context-menu>` with the
 * per-node actions a webview view's rows otherwise have no way to reach
 * (`view/item/context` doesn't exist for webview views) — View Source always,
 * New Class / Save Package As for a package row — and relays the choice to the
 * matching `modelica.*` command.
 */

import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";

import "@dicode/diagram-ui";
import type {
  ContextMenuItem,
  ContextMenuSelectDetail,
  LibraryContextMenuDetail,
  LibraryPlacementStartDetail,
  LibraryRootLoadedDetail,
  LibraryEvents,
  OmContextMenu,
} from "@dicode/diagram-ui";
import { omTokens } from "@dicode/ui-common";

import { WebviewLibraryDataSource } from "./library-data-source.js";
import type {
  ExtensionToLibraryView,
  LibraryViewToExtension,
} from "./library-view-protocol.js";
import { getVsCodeApi } from "./vscode-api.js";

type Phase = "loading" | "empty" | "error" | "ready";

@customElement("om-library-view-root")
export class OmLibraryViewRoot extends LitElement {
  static override styles = [
    omTokens,
    css`
      :host {
        display: block;
        position: absolute;
        inset: 0;
        color: var(--vscode-foreground);
        font-family: var(--vscode-font-family, system-ui, sans-serif);
        font-size: var(--vscode-font-size, var(--om-tree-font-size));
      }
      om-library-tree {
        display: flex;
        block-size: 100%;
      }
      .state {
        display: flex;
        flex-direction: column;
        gap: var(--om-space-md);
        padding: var(--om-space-lg);
        color: var(--vscode-descriptionForeground);
        font-size: var(--om-description-size);
      }
      .state.error {
        color: var(--vscode-errorForeground);
      }
      .hint {
        color: var(--vscode-descriptionForeground);
      }
      button {
        align-self: flex-start;
        padding: var(--om-input-padding);
        font: inherit;
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
        border: 1px solid var(--vscode-button-border, transparent);
        border-radius: var(--om-radius-md);
        cursor: pointer;
      }
      button:hover {
        background: var(--vscode-button-hoverBackground);
      }
    `,
  ];

  @state() private phase: Phase = "loading";
  @state() private errorText = "";
  /** Bumped on each reload so `<om-library-tree>` re-fetches against the same
   *  source. A fresh source would restart request ids and collide with any
   *  in-flight request, routing its response to the wrong instance. */
  @state() private reloadToken = 0;

  private readonly vscode = getVsCodeApi<LibraryViewToExtension>();
  /** One persistent bridge for the view's lifetime — never swapped. Replacing
   *  it while a tree fetch is in flight would orphan that request's response
   *  and hang the row on "Loading…". */
  private readonly source = new WebviewLibraryDataSource((msg) =>
    this.vscode.postMessage(msg),
  );
  /** True between a row press and the matching release, so a release cancels an
   *  uncommitted placement (a plain click, or a drag that never reached the
   *  canvas). A drop over the canvas commits in the diagram webview and never
   *  reaches this iframe's `pointerup`. */
  private placing = false;

  @query("om-context-menu") private contextMenuEl?: OmContextMenu;
  /** The row the open context menu was raised for, so a selected action knows
   *  which class to target. */
  private contextMenuNode: LibraryContextMenuDetail | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("message", this.onHostMessage);
    window.addEventListener("pointerup", this.onGlobalPointerUp);
    window.addEventListener("pointercancel", this.onGlobalPointerUp);
    window.addEventListener("keydown", this.onKeyDown);
    // The tree fetches its root once on mount and reports the outcome via
    // `om-library-root-loaded`; we don't issue a second probe fetch here.
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("message", this.onHostMessage);
    window.removeEventListener("pointerup", this.onGlobalPointerUp);
    window.removeEventListener("pointercancel", this.onGlobalPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);
  }

  /** A user-initiated reload (toolbar Refresh, Load Library, Create Class):
   *  bump the token so the mounted tree rebuilds and re-fetches once. The phase
   *  then follows the tree's `om-library-root-loaded`. */
  private onReload(): void {
    this.phase = "loading";
    this.reloadToken += 1;
  }

  private readonly onHostMessage = (e: MessageEvent): void => {
    const data = e.data as ExtensionToLibraryView | undefined;
    if (!data || typeof data !== "object" || !("type" in data)) return;
    switch (data.type) {
      case "libraryChildren":
      case "librarySearchResult":
        this.source.handleResponse(data);
        return;
      case "libraryIconResult":
        this.source.handleIconResponse(data);
        return;
      case "reload":
        this.onReload();
        return;
    }
  };

  private readonly onGlobalPointerUp = (): void => {
    this.cancelPlacement();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      this.cancelPlacement();
    }
  };

  private cancelPlacement(): void {
    if (!this.placing) return;
    this.placing = false;
    this.vscode.postMessage({ type: "placementCancel" });
  }

  override render(): TemplateResult {
    return html`${this.renderBody()}
      <om-context-menu
        @om-context-menu-select=${this.onContextMenuSelect}
      ></om-context-menu>`;
  }

  private renderBody(): TemplateResult {
    // The tree stays mounted while loading and ready so its single root fetch
    // drives the phase (via `om-library-root-loaded`); empty / error swap in
    // their own chrome. Reusing one `tree` template keeps the element across
    // the loading → ready transition (no remount, no second fetch).
    if (this.phase === "empty") {
      return html`<div class="state">
        <span>No Modelica libraries are loaded yet.</span>
        <button @click=${this.onLoadLibrary}>Load Library…</button>
        <span class="hint"
          >The default "Modelica" name resolves the Modelica Standard Library
          from your MODELICAPATH.</span
        >
      </div>`;
    }
    if (this.phase === "error") {
      return html`<div class="state error">
        <span>Failed to load libraries: ${this.errorText}</span>
        <button @click=${this.onReloadClick}>Retry</button>
      </div>`;
    }
    return html`<om-library-tree
      placement-drag
      .dataSource=${this.source}
      .reloadToken=${this.reloadToken}
      @om-library-select=${this.onSelect}
      @om-library-placement-start=${this.onPlacementStart}
      @om-library-root-loaded=${this.onRootLoaded}
      @om-library-context-menu=${this.onRowContextMenu}
    ></om-library-tree>`;
  }

  private readonly onRootLoaded = (
    e: CustomEvent<LibraryRootLoadedDetail>,
  ): void => {
    if (e.detail.ok) {
      this.phase = e.detail.empty ? "empty" : "ready";
    } else {
      this.errorText = e.detail.error;
      this.phase = "error";
    }
  };

  private readonly onSelect = (
    e: CustomEvent<LibraryEvents["om-library-select"]>,
  ): void => {
    this.vscode.postMessage({
      type: "openDiagram",
      className: e.detail.className,
    });
  };

  private readonly onPlacementStart = (
    e: CustomEvent<LibraryPlacementStartDetail>,
  ): void => {
    this.placing = true;
    this.vscode.postMessage({
      type: "placementStart",
      className: e.detail.className,
    });
  };

  private readonly onLoadLibrary = (): void => {
    this.vscode.postMessage({ type: "loadLibrary" });
  };

  private readonly onRowContextMenu = (
    e: CustomEvent<LibraryEvents["om-library-context-menu"]>,
  ): void => {
    const node = e.detail;
    const menu = this.contextMenuEl;
    if (!menu) return;
    this.contextMenuNode = node;
    menu.items = contextMenuItemsFor(node.restriction);
    menu.open(node.x, node.y);
  };

  private readonly onContextMenuSelect = (
    e: CustomEvent<ContextMenuSelectDetail>,
  ): void => {
    const node = this.contextMenuNode;
    if (!node || !isLibraryNodeCommand(e.detail.id)) return;
    this.vscode.postMessage({
      type: "libraryNodeCommand",
      command: e.detail.id,
      node: {
        qualifiedName: node.className,
        displayName: node.displayName,
        restriction: node.restriction,
      },
    });
  };

  private readonly onReloadClick = (): void => {
    this.onReload();
  };
}

/** The `libraryNodeCommand` variants a context-menu selection can resolve to. */
const LIBRARY_NODE_COMMANDS = [
  "viewSource",
  "createClass",
  "savePackage",
] as const;
type LibraryNodeCommand = (typeof LIBRARY_NODE_COMMANDS)[number];

function isLibraryNodeCommand(id: string): id is LibraryNodeCommand {
  return (LIBRARY_NODE_COMMANDS as readonly string[]).includes(id);
}

/**
 * The per-node actions offered for `restriction`. View Source applies to any
 * concrete row; New Class / Save Package As only make sense on a package (or
 * a loaded library's root, which reports restriction `"package"` too) —
 * mirrors `modelica.createClass`'s `parentFromNode` and `modelica.savePackage`
 * requiring a package/library node.
 */
function contextMenuItemsFor(
  restriction: LibraryContextMenuDetail["restriction"],
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    { id: "viewSource", label: "View Source", group: "class" },
  ];
  if (restriction === "package") {
    items.push(
      { id: "createClass", label: "New Class...", group: "package" },
      { id: "savePackage", label: "Save Package As...", group: "package" },
    );
  }
  return items;
}

declare global {
  interface HTMLElementTagNameMap {
    "om-library-view-root": OmLibraryViewRoot;
  }
}
