/**
 * `modelica.libraries` sidebar as a webview view. Replaces the native
 * `TreeDataProvider` with a full-height `<om-library-tree>` (bundled into
 * `out/library-view.js`) so the sidebar shares the diagram's visual language and
 * can begin host-mediated placement onto the canvas — HTML5 drag can't cross the
 * webview iframe boundary.
 *
 * The webview browses the same OMC-backed data the diagram library browser uses
 * (`LibrarySource`); this provider owns the host end of that bridge plus
 * the sidebar-only actions (open a class's diagram, relay a placement to the
 * active diagram, run Load Library, reload after a mutation).
 */

import * as vscode from "vscode";

import type { OmcClient } from "@dicode/omc-client";

import { LibrarySource } from "../diagram/library-source.js";
import { libraryIconSvg } from "../diagram/open-diagram.js";
import { DiagramPanel } from "../diagram/panel.js";
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
    void this.post({ type: "reload" });
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
      case "librarySearch":
        void this.handleItemsRequest(
          webview,
          message.requestId,
          "librarySearchResult",
          (s) => s.searchAll(message.query),
        );
        return;
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
      const error = err instanceof Error ? err.message : String(err);
      await this.post({ type: responseType, requestId, error }, webview);
    }
  }

  private async handleIconRequest(
    webview: vscode.Webview,
    requestId: string,
    className: string,
  ): Promise<void> {
    try {
      const client = await this.ensureClient();
      const svg = await libraryIconSvg(client, className);
      await this.post(
        svg === undefined
          ? { type: "libraryIconResult", requestId }
          : { type: "libraryIconResult", requestId, svg },
        webview,
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.post({ type: "libraryIconResult", requestId, error }, webview);
    }
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
