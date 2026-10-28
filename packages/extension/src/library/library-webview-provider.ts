/**
 * `modelica.libraries` sidebar as a webview view. Replaces the native
 * `TreeDataProvider` with a full-height `<om-library-tree>` (bundled into
 * `out/library-view.js`) so the sidebar shares the diagram's visual language and
 * can begin host-mediated placement onto the canvas — HTML5 drag can't cross the
 * webview iframe boundary.
 *
 * The webview browses OMC-backed data through `LibrarySource`; this provider
 * owns the host end of that bridge plus
 * the sidebar-only actions (open an activated class in the view its restriction
 * routes to, relay a placement to the active diagram, run Load Library, signal
 * targeted invalidations after a mutation, run a row's context-menu command).
 */

import * as vscode from "vscode";

import type { ClassDef, OmcClient } from "@dicode/omc-client";

import {
  LibrarySource,
  SearchAbortedError,
} from "../diagram/library-source.js";
import {
  fetchComponentClass,
  libraryIconSvg,
} from "../diagram/open-diagram.js";
import {
  DIAGRAM_VIEW_TYPE,
  DiagramEditorProvider,
} from "../diagram/diagram-editor-provider.js";
import { DOCUMENTATION_VIEW_TYPE } from "../diagram/view-type.js";
import type { ClassInvalidationRegistry } from "../invalidation.js";
import { log } from "../logger.js";
import { sourceUriFor } from "../source-provider.js";
import { DerivedCache, type Computed } from "./derived-cache.js";
import { renderWebviewPage } from "../webview/webview-page.js";
import type { LibraryClassInfo } from "../webview/library-messages.js";
import type {
  ExtensionToLibraryView,
  LibraryActivationView,
  LibraryViewToExtension,
} from "../webview/library-view-protocol.js";

export const LIBRARY_VIEW_ID = "modelica.libraries";

/** The `vscode.openWith` editor for each activation view. `"default"` is the
 *  built-in text editor — the source view has no custom viewType. */
function editorForView(view: LibraryActivationView): string {
  switch (view) {
    case "diagram":
      return DIAGRAM_VIEW_TYPE;
    case "documentation":
      return DOCUMENTATION_VIEW_TYPE;
    case "source":
      return "default";
  }
}

type EnsureClient = () => Promise<OmcClient>;

export class LibraryWebviewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private view: vscode.WebviewView | undefined;
  private cached: { client: OmcClient; source: LibrarySource } | undefined;
  /** Rendered icon SVG per class, or `undefined` for "this class has no icon".
   *  Rendering one instantiates the class in OMC, so a miss is expensive and a
   *  negative result is worth remembering. A subtype's icon inherits its base's
   *  graphics, so it declares the base as a dependency and refreshes with it. */
  private readonly icons = new DerivedCache<string, string | undefined>({
    topic: "libraryIcon",
    compute: (className, { fresh }) => this.renderIcon(className, fresh),
    // A mutation just landed, and OMC's cheap annotation read would still
    // report the prior elaboration: tell the webview to re-request the class,
    // and drop the preview resolved from the same definition.
    onInvalidate: (className) => {
      this.previews.invalidate(className);
      void this.post({ type: "libraryIconChanged", className });
    },
  });
  /** Successfully resolved preview definitions per class, so re-dragging one
   *  doesn't re-fetch its full model instance. A class that fails to resolve is
   *  not cached — the crosshair covers the interim and the next drag retries,
   *  so a transient failure isn't remembered as a permanent no-preview. */
  private readonly previews = new DerivedCache<string, ClassDef | undefined>({
    topic: "placementPreview",
    compute: async (className) => ({
      value: await this.resolvePreview(className),
    }),
    shouldCache: (def) => def !== undefined,
  });
  /** In-flight searches, so `libraryCancel` can abandon their queued lookups. */
  private readonly searches = new Map<string, AbortController>();

  private readonly onInvalidation: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly ensureClient: EnsureClient,
    invalidation: ClassInvalidationRegistry,
  ) {
    // Both coarse signals drop the icon cache: neither an unattributable
    // mutation nor a dead session leaves a cached icon trustworthy, and
    // neither names the classes it invalidated.
    this.onInvalidation = vscode.Disposable.from(
      invalidation.register((className) => this.classChanged(className)),
      invalidation.registerAllClassesChanged(() => this.refresh()),
      invalidation.registerSessionReplaced(() => this.refresh()),
    );
  }

  dispose(): void {
    this.onInvalidation.dispose();
  }

  /** Drop everything this sidebar derives from `className`'s definition: its
   *  rendered icon and the restriction its row badges. */
  private classChanged(className: string): void {
    this.cached?.source.invalidateRestriction(className);
    this.icons.invalidate(className);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "out")],
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((m: LibraryViewToExtension) =>
      this.handleMessage(webviewView.webview, m),
    );
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) this.view = undefined;
    });
  }

  /** Tell the webview to drop everything and re-fetch. The manual Refresh
   *  command's wholesale escape hatch; mutations with a known scope use
   *  `childrenChanged` / the invalidation registry instead. No-op when the view isn't
   *  resolved. */
  refresh(): void {
    // A mutation may have changed what a class's icon looks like, or removed it.
    this.dropIconCache();
    void this.post({ type: "reload" });
  }

  /** A structural change under `parent` (`null` = the root listing): the
   *  webview re-lists that node's children and keeps every other cache —
   *  icons, untouched subtrees, expansion, search — warm. */
  childrenChanged(parent: string | null): void {
    void this.post({ type: "libraryChildrenChanged", parent });
  }

  /** Abandon a search the webview no longer wants. Its queued OMC lookups stop
   *  at the next `signal.aborted` check instead of running to completion. */
  private cancelSearch(requestId: string): void {
    const controller = this.searches.get(requestId);
    if (!controller) return;
    controller.abort();
    this.searches.delete(requestId);
    log.debug("librarySource", `search ${requestId} cancelled by the webview`);
  }

  private dropIconCache(): void {
    const dropped = this.icons.clear();
    this.previews.clear();
    log.debug("libraryIcon", `dropped ${dropped} cached icons`);
  }

  /** Resolve `className`'s renderable definition and relay it to the diagram so
   *  the placement preview upgrades from the crosshair to the real node. Silent
   *  on a miss — the crosshair simply stays. */
  private async relayPreview(className: string): Promise<void> {
    try {
      const def = await this.previews.get(className);
      if (def === undefined) return;
      DiagramEditorProvider.relayPlacementPreview(className, def);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn("placementPreview", `resolve failed for ${className}: ${error}`);
    }
  }

  private async resolvePreview(
    className: string,
  ): Promise<ClassDef | undefined> {
    const started = Date.now();
    const client = await this.ensureClient();
    const def = await fetchComponentClass(client, className);
    if (def !== undefined) {
      log.debug(
        "placementPreview",
        `resolved ${className} in ${Date.now() - started}ms (${Object.keys(def.connectors).length} ports)`,
      );
    }
    return def;
  }

  private handleMessage(
    webview: vscode.Webview,
    message: LibraryViewToExtension,
  ): void {
    switch (message.type) {
      case "libraryListChildren":
        void this.handleItemsRequest(
          webview,
          message.requestId,
          "libraryChildren",
          (s) => s.listChildren(message.parent),
        );
        return;
      case "libraryCancel":
        this.cancelSearch(message.requestId);
        return;
      case "librarySearch": {
        const controller = new AbortController();
        this.searches.set(message.requestId, controller);
        void this.handleItemsRequest(
          webview,
          message.requestId,
          "librarySearchResult",
          (s) => s.searchAll(message.query, controller.signal),
        ).finally(() => this.searches.delete(message.requestId));
        return;
      }
      case "libraryIcon":
        void this.handleIconRequest(
          webview,
          message.requestId,
          message.className,
        );
        return;
      case "openClassView":
        void vscode.commands.executeCommand(
          "vscode.openWith",
          sourceUriFor(message.className),
          editorForView(message.view),
        );
        return;
      case "placementStart":
        DiagramEditorProvider.relayPlacement(message.className);
        void this.relayPreview(message.className);
        return;
      case "placementCancel":
        DiagramEditorProvider.relayPlacement(null);
        return;
      case "loadLibrary":
        void vscode.commands.executeCommand("modelica.loadLibrary");
        return;
      case "libraryNodeCommand":
        void vscode.commands.executeCommand(`modelica.${message.command}`, {
          qualifiedName: message.node.qualifiedName,
          displayName: message.node.displayName,
          restriction: message.node.restriction,
        });
        return;
      default:
        // A new protocol variant must add a case above; this keeps the
        // compiler enforcing that.
        return message satisfies never;
    }
  }

  /** Lazily build (and cache) the OMC-backed source for the current client. */
  private async source(): Promise<LibrarySource> {
    const client = await this.ensureClient();
    if (this.cached?.client !== client) {
      this.cached = { client, source: new LibrarySource(client) };
      this.dropIconCache();
    }
    return this.cached.source;
  }

  private async handleItemsRequest(
    webview: vscode.Webview,
    requestId: string,
    responseType: "libraryChildren" | "librarySearchResult",
    fetch: (source: LibrarySource) => Promise<LibraryClassInfo[]>,
  ): Promise<void> {
    try {
      const items = await fetch(await this.source());
      await this.post({ type: responseType, requestId, items }, webview);
    } catch (err) {
      if (err instanceof SearchAbortedError) {
        // The webview settled this request when it aborted; a reply would find
        // no pending entry, and an error toast would be a lie.
        return;
      }
      const error = err instanceof Error ? err.message : String(err);
      log.warn("libraryView", `${responseType} failed: ${error}`);
      await this.post({ type: responseType, requestId, error }, webview);
    }
  }

  private async handleIconRequest(
    webview: vscode.Webview,
    requestId: string,
    className: string,
  ): Promise<void> {
    try {
      const svg = await this.icons.get(className);
      await this.post(
        svg === undefined
          ? { type: "libraryIconResult", requestId }
          : { type: "libraryIconResult", requestId, svg },
        webview,
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn("libraryIcon", `render failed for ${className}: ${error}`);
      await this.post({ type: "libraryIconResult", requestId, error }, webview);
    }
  }

  private async renderIcon(
    className: string,
    fresh: boolean,
  ): Promise<Computed<string, string | undefined>> {
    const started = Date.now();
    const client = await this.ensureClient();
    const { svg, dependsOn } = await libraryIconSvg(client, className, fresh);
    const shape = svg === undefined ? "no icon" : `${svg.length} bytes`;
    log.debug(
      "libraryIcon",
      `rendered ${className} in ${Date.now() - started}ms (${shape})`,
    );
    return { value: svg, dependsOn };
  }

  private post(
    message: ExtensionToLibraryView,
    webview = this.view?.webview,
  ): Thenable<boolean> | undefined {
    return webview?.postMessage(message);
  }

  private renderHtml(webview: vscode.Webview): string {
    return renderWebviewPage({
      webview,
      extensionUri: this.extensionUri,
      entry: "library-view",
      title: "Modelica Libraries",
      root: "<om-library-view-root></om-library-view-root>",
    });
  }
}
