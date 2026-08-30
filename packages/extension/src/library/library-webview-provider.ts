/**
 * `modelica.libraries` sidebar as a webview view. Replaces the native
 * `TreeDataProvider` with a full-height `<om-library-tree>` (bundled into
 * `out/library-view.js`) so the sidebar shares the diagram's visual language and
 * can begin host-mediated placement onto the canvas — HTML5 drag can't cross the
 * webview iframe boundary.
 *
 * The webview browses OMC-backed data through `LibrarySource`; this provider
 * owns the host end of that bridge plus
 * the sidebar-only actions (open a class's diagram, relay a placement to the
 * active diagram, run Load Library, signal targeted invalidations after a
 * mutation, run a row's context-menu command).
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
import type { ClassInvalidationRegistry } from "../invalidation.js";
import { log } from "../logger.js";
import { sourceUriFor } from "../source-provider.js";
import { renderWebviewPage } from "../webview/webview-page.js";
import type { LibraryClassInfo } from "../webview/library-messages.js";
import type {
  ExtensionToLibraryView,
  LibraryViewToExtension,
} from "../webview/library-view-protocol.js";

export const LIBRARY_VIEW_ID = "modelica.libraries";

type EnsureClient = () => Promise<OmcClient>;

export class LibraryWebviewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private view: vscode.WebviewView | undefined;
  private cached: { client: OmcClient; source: LibrarySource } | undefined;
  /** Rendered icon SVG per class, or `undefined` for "this class has no icon".
   *  Rendering one instantiates the class in OMC, so a miss is expensive and a
   *  negative result is worth remembering. */
  private iconCache = new Map<string, string | undefined>();
  /** Successfully resolved preview definitions per class, so re-dragging one
   *  doesn't re-fetch its full model instance. A class that fails to resolve is
   *  not cached — the crosshair covers the interim and the next drag retries,
   *  so a transient failure isn't remembered as a permanent no-preview. */
  private previewCache = new Map<string, ClassDef>();
  /** Renders not yet settled, so a burst of rows sharing a class renders once.
   *  Map membership is ownership: `refresh` (wholesale) and `iconChanged`
   *  (per class) disown a render by removing its entry, so it can neither be
   *  joined nor write its pre-mutation bytes into the cache. */
  private readonly iconInFlight = new Map<
    string,
    Promise<string | undefined>
  >();
  /** Classes whose next render must force a full re-elaboration. `iconChanged`
   *  marks the edited class here because OMC's cheap annotation read lags a
   *  commit behind; the mark is consumed by the render it triggers. */
  private readonly freshOnce = new Set<string>();
  /** Base class → the rendered classes whose icon inherits its graphics, built
   *  from each render's `extends` chain. `iconChanged` cascades an edit down
   *  this index so a subtype's inherited icon refreshes with its base. Edges
   *  are not pruned on cache eviction, only on re-render: a stale or emptied
   *  edge can only over-invalidate (a redundant re-request), never render wrong
   *  bytes, and it self-heals on the subtype's next render. */
  private readonly iconDependents = new Map<string, Set<string>>();
  /** Class → the base classes recorded for its last render, so a re-render can
   *  prune its stale reverse edges out of {@link iconDependents} before adding
   *  the fresh ones. */
  private readonly iconDependsOn = new Map<string, readonly string[]>();
  /** Monotonic tick bumped by every {@link invalidateIcon}. A render snapshots
   *  it at the start and compares against {@link lastInvalidated} on completion
   *  to catch a base edited mid-render, before its edge existed to cascade. */
  private invalidationTick = 0;
  /** Class → the {@link invalidationTick} at which it was last invalidated. */
  private readonly lastInvalidated = new Map<string, number>();
  /** In-flight searches, so `libraryCancel` can abandon their queued lookups. */
  private readonly searches = new Map<string, AbortController>();

  private readonly onClassChanged: vscode.Disposable;
  private readonly onSessionReplaced: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly ensureClient: EnsureClient,
    invalidation: ClassInvalidationRegistry,
  ) {
    this.onClassChanged = invalidation.register((className) =>
      this.classChanged(className),
    );
    // `refresh()` rather than a re-list: an icon cached from the dead
    // session would otherwise keep serving its stale bytes.
    this.onSessionReplaced = invalidation.registerSessionReplaced(() => {
      this.refresh();
    });
  }

  dispose(): void {
    this.onClassChanged.dispose();
    this.onSessionReplaced.dispose();
  }

  /** Drop everything this sidebar derives from `className`'s definition: its
   *  rendered icon and the restriction its row badges. */
  private classChanged(className: string): void {
    this.cached?.source.invalidateRestriction(className);
    this.iconChanged(className);
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
   *  `childrenChanged` / `iconChanged` instead. No-op when the view isn't
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

  /** `className`'s rendered icon may have changed: invalidate it and every
   *  class whose icon inherits its graphics. A subtype's icon includes its
   *  base's shapes, so an edit to the base must refresh the subtype too — the
   *  base is not part of the subtype's own last elaboration, so its cheap
   *  annotation read would still paint the pre-edit inherited icon. */
  private iconChanged(className: string): void {
    this.invalidateIcon(className);
    for (const dependent of this.iconDependents.get(className) ?? []) {
      this.invalidateIcon(dependent);
    }
  }

  /** Evict one class from the host caches and tell the webview to re-request
   *  it. A render already in flight carries pre-mutation bytes — disowning its
   *  `iconInFlight` entry keeps it from writing into the cache or being joined.
   *  The re-request must re-elaborate the class (`freshOnce`): a mutation just
   *  landed, and OMC's cheap annotation read would still report the prior
   *  elaboration. */
  private invalidateIcon(className: string): void {
    this.iconCache.delete(className);
    this.previewCache.delete(className);
    this.iconInFlight.delete(className);
    this.freshOnce.add(className);
    this.lastInvalidated.set(className, ++this.invalidationTick);
    void this.post({ type: "libraryIconChanged", className });
  }

  /** Record the base classes a render found in `className`'s `extends` chain,
   *  replacing any edges from its previous render, so `iconChanged` on a base
   *  reaches this subtype. Edges are recorded at render completion; an edit to a
   *  base during the render lands before its edge exists, and the caller's
   *  {@link baseInvalidatedSince} check covers that window. */
  private recordIconDependencies(
    className: string,
    dependsOn: readonly string[],
  ): void {
    for (const base of this.iconDependsOn.get(className) ?? []) {
      this.iconDependents.get(base)?.delete(className);
    }
    this.iconDependsOn.set(className, dependsOn);
    for (const base of dependsOn) {
      let dependents = this.iconDependents.get(base);
      if (dependents === undefined) {
        dependents = new Set();
        this.iconDependents.set(base, dependents);
      }
      dependents.add(className);
    }
  }

  /** Whether any of `bases` was invalidated after `sinceTick` — i.e. edited
   *  while a render that started at `sinceTick` was still in flight, so that
   *  render's bytes predate the edit. */
  private baseInvalidatedSince(
    bases: readonly string[],
    sinceTick: number,
  ): boolean {
    return bases.some(
      (base) => (this.lastInvalidated.get(base) ?? 0) > sinceTick,
    );
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
    const dropped = this.iconCache.size;
    this.iconCache.clear();
    this.previewCache.clear();
    this.iconInFlight.clear();
    // `freshOnce` is left intact: it marks only classes edited since their last
    // render, so a reload racing a just-landed edit must still re-elaborate them
    // rather than repaint the stale annotation read. Clearing it re-stales the
    // very class `iconChanged` just marked.
    log.debug("libraryIcon", `dropped ${dropped} cached icons`);
  }

  /** Resolve `className`'s renderable definition and relay it to the diagram so
   *  the placement preview upgrades from the crosshair to the real node. Silent
   *  on a miss — the crosshair simply stays. */
  private async relayPreview(className: string): Promise<void> {
    try {
      let def = this.previewCache.get(className);
      if (def === undefined) {
        const started = Date.now();
        const client = await this.ensureClient();
        const resolved = await fetchComponentClass(client, className);
        if (resolved === undefined) return;
        def = resolved;
        this.previewCache.set(className, def);
        log.debug(
          "placementPreview",
          `resolved ${className} in ${Date.now() - started}ms (${Object.keys(def.connectors).length} ports)`,
        );
      }
      DiagramEditorProvider.relayPlacementPreview(className, def);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn("placementPreview", `resolve failed for ${className}: ${error}`);
    }
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
      case "openDiagram":
        void vscode.commands.executeCommand(
          "vscode.openWith",
          sourceUriFor(message.className),
          DIAGRAM_VIEW_TYPE,
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
      const svg = await this.iconSvg(className);
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

  /**
   * Rendered icon for `className`, memoized. Concurrent requests for the same
   * class share one render: rows scroll into view in bursts, and OMC serializes
   * every call, so a duplicate render is a round-trip the whole channel waits
   * behind.
   */
  private iconSvg(className: string): Promise<string | undefined> {
    if (this.iconCache.has(className)) {
      log.debug("libraryIcon", `cache hit ${className}`);
      return Promise.resolve(this.iconCache.get(className));
    }
    const inFlight = this.iconInFlight.get(className);
    if (inFlight) {
      log.debug("libraryIcon", `joining in-flight render ${className}`);
      return inFlight;
    }
    const started = Date.now();
    // Consumed here, not on join/cache-hit: a cache-hit serves evicted-then-
    // stale bytes and a join rides an already-started render, so neither would
    // re-elaborate. `iconChanged` re-arms the mark when it disowns a running
    // render, so the replacement this starts still forces a full instance.
    const fresh = this.freshOnce.delete(className);
    // Snapshot before the fetch: a base invalidated past this tick may predate
    // the bytes this render produces, and its edge doesn't exist yet to
    // cascade, so the completion re-invalidates on it. Conservative — the
    // snapshot precedes the OMC read, so at worst it costs one needless
    // re-render, never a stale icon.
    const startTick = this.invalidationTick;
    // `self` aliases `promise` for the ownership checks — the const can't be
    // referenced inside its own initializer's immediately-invoked body.
    let self: Promise<string | undefined> | undefined = undefined;
    const promise = (async () => {
      const client = await this.ensureClient();
      const { svg, dependsOn } = await libraryIconSvg(client, className, fresh);
      // Cache only while still owned: `refresh` and `iconChanged` disown the
      // in-flight entry, and a disowned render carries pre-mutation bytes.
      if (self !== undefined && this.iconInFlight.get(className) === self) {
        this.iconCache.set(className, svg);
        // A failed render reports `dependsOn` as `undefined` (chain unknown);
        // keep the last good edges rather than pruning them off a transient miss.
        if (dependsOn !== undefined) {
          this.recordIconDependencies(className, dependsOn);
          // A base edited mid-render missed the cascade (no edge yet); now that
          // its edge exists, drop the possibly-stale bytes and re-render.
          if (this.baseInvalidatedSince(dependsOn, startTick)) {
            this.invalidateIcon(className);
          }
        }
      }
      const shape = svg === undefined ? "no icon" : `${svg.length} bytes`;
      log.debug(
        "libraryIcon",
        `rendered ${className} in ${Date.now() - started}ms (${shape})`,
      );
      return svg;
    })().finally(() => {
      // A newer render may have replaced this entry; only clear our own.
      if (self !== undefined && this.iconInFlight.get(className) === self) {
        this.iconInFlight.delete(className);
      }
    });
    self = promise;
    this.iconInFlight.set(className, promise);
    return promise;
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
