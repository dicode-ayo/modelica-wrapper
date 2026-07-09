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
 * active diagram, run Load Library, reload after a mutation).
 */

import * as vscode from "vscode";

import type { OmcClient } from "@dicode/omc-client";

import {
  LibrarySource,
  SearchAbortedError,
} from "../diagram/library-source.js";
import { libraryIconSvg } from "../diagram/open-diagram.js";
import { DiagramPanel } from "../diagram/panel.js";
import { log } from "../logger.js";
import { randomNonce } from "../webview/nonce.js";
import type { LibraryClassInfo } from "../webview/library-messages.js";
import type {
  ExtensionToLibraryView,
  LibraryViewToExtension,
} from "../webview/library-view-protocol.js";

export const LIBRARY_VIEW_ID = "modelica.libraries";

type EnsureClient = () => Promise<OmcClient>;

export class LibraryWebviewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private cached: { client: OmcClient; source: LibrarySource } | undefined;
  /** Rendered icon SVG per class, or `undefined` for "this class has no icon".
   *  Rendering one instantiates the class in OMC, so a miss is expensive and a
   *  negative result is worth remembering. */
  private iconCache = new Map<string, string | undefined>();
  /** Renders not yet settled, so a burst of rows sharing a class renders once.
   *  Tagged with the generation they started under: a render from before a
   *  Refresh carries pre-Refresh bytes and must not be joined after it. */
  private readonly iconInFlight = new Map<
    string,
    { generation: number; promise: Promise<string | undefined> }
  >();
  /** Bumped whenever the cache is dropped, so a render started against the old
   *  library state can't write its result into the new one. */
  private iconGeneration = 0;
  /** In-flight searches, so `libraryCancel` can abandon their queued lookups. */
  private readonly searches = new Map<string, AbortController>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly ensureClient: EnsureClient,
  ) {}

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

  /** Tell the webview to re-fetch after a mutation (Load Library / Create Class
   *  / auto-load on activation). No-op when the view isn't resolved. */
  refresh(): void {
    // A mutation may have changed what a class's icon looks like, or removed it.
    this.dropIconCache();
    void this.post({ type: "reload" });
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
    this.iconGeneration++;
    const dropped = this.iconCache.size;
    this.iconCache.clear();
    log.debug("libraryIcon", `dropped ${dropped} cached icons`);
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
          "modelica.openDiagram",
          message.className,
        );
        return;
      case "placementStart":
        DiagramPanel.relayPlacement(message.className);
        return;
      case "placementCancel":
        DiagramPanel.relayPlacement(null);
        return;
      case "loadLibrary":
        void vscode.commands.executeCommand("modelica.loadLibrary");
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
    const generation = this.iconGeneration;
    const inFlight = this.iconInFlight.get(className);
    if (inFlight && inFlight.generation === generation) {
      log.debug("libraryIcon", `joining in-flight render ${className}`);
      return inFlight.promise;
    }
    const started = Date.now();
    const promise = (async () => {
      const client = await this.ensureClient();
      const svg = await libraryIconSvg(client, className);
      if (generation === this.iconGeneration) {
        this.iconCache.set(className, svg);
      }
      const shape = svg === undefined ? "no icon" : `${svg.length} bytes`;
      log.debug(
        "libraryIcon",
        `rendered ${className} in ${Date.now() - started}ms (${shape})`,
      );
      return svg;
    })().finally(() => {
      // A newer generation may have replaced this entry; only clear our own.
      if (this.iconInFlight.get(className)?.promise === promise) {
        this.iconInFlight.delete(className);
      }
    });
    this.iconInFlight.set(className, { generation, promise });
    return promise;
  }

  private post(
    message: ExtensionToLibraryView,
    webview = this.view?.webview,
  ): Thenable<boolean> | undefined {
    return webview?.postMessage(message);
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "library-view.js"),
    );
    const nonce = randomNonce();
    const csp = [
      `default-src 'none'`,
      `script-src 'nonce-${nonce}'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `img-src ${webview.cspSource} data: blob:`,
      `font-src ${webview.cspSource} data:`,
    ].join("; ");
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>Modelica Libraries</title>
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden; }
    </style>
  </head>
  <body>
    <om-library-view-root></om-library-view-root>
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}
