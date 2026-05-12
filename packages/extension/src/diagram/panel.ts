import * as vscode from "vscode";
import type { DiagramLayout } from "@modelica-wrapper/omc-client";

import type {
  ExtensionToWebview,
  WebviewToExtension,
} from "../webview/protocol.js";

/**
 * Wraps a `vscode.WebviewPanel` and the message handlers between the
 * extension host and the diagram-ui browser bundle.
 *
 * Lifecycle: one panel per opened class (`className` as key). Re-using
 * the same panel when the user re-runs `Modelica: Open Diagram` on
 * the same class keeps the editor tabs tidy.
 */

export interface DiagramPanelHandlers {
  onChange?: (layout: DiagramLayout) => void;
  onConnectionCreate?: (fromKey: string, toKey: string) => void;
  onSelectionChange?: (keys: string[]) => void;
}

export class DiagramPanel {
  private static readonly panels = new Map<string, DiagramPanel>();
  /** Most-recently active diagram panel — used by toolbar toggle commands
   *  that don't receive an argument. */
  private static activePanel: DiagramPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private ready = false;
  private pendingInit: ExtensionToWebview | null = null;

  /** Class name of the currently active diagram, or undefined if none. */
  static activeClassName(): string | undefined {
    return DiagramPanel.activePanel?.className;
  }

  private constructor(
    private readonly className: string,
    private layout: DiagramLayout,
    private readonly extensionUri: vscode.Uri,
    private readonly handlers: DiagramPanelHandlers,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "modelicaDiagram",
      `Diagram: ${className}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "out")],
      },
    );
    this.panel.webview.html = this.renderHtml();
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((m) => this.handleMessage(m)),
    );
    this.disposables.push(
      this.panel.onDidChangeViewState((e) => {
        if (e.webviewPanel.active) {
          DiagramPanel.activePanel = this;
        } else if (DiagramPanel.activePanel === this) {
          DiagramPanel.activePanel = undefined;
        }
      }),
    );
    this.disposables.push(this.panel.onDidDispose(() => this.dispose()));
    DiagramPanel.activePanel = this;
    this.pendingInit = {
      type: "init",
      layout: this.layout,
      className: this.className,
    };
  }

  static open(
    extensionUri: vscode.Uri,
    className: string,
    layout: DiagramLayout,
    handlers: DiagramPanelHandlers,
  ): DiagramPanel {
    const existing = DiagramPanel.panels.get(className);
    if (existing) {
      existing.update(layout);
      existing.panel.reveal();
      return existing;
    }
    const panel = new DiagramPanel(
      className,
      layout,
      extensionUri,
      handlers,
    );
    DiagramPanel.panels.set(className, panel);
    return panel;
  }

  update(layout: DiagramLayout): void {
    this.layout = layout;
    this.send({ type: "layout", layout });
  }

  dispose(): void {
    DiagramPanel.panels.delete(this.className);
    if (DiagramPanel.activePanel === this) {
      DiagramPanel.activePanel = undefined;
    }
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        // best-effort
      }
    }
  }

  private send(message: ExtensionToWebview): void {
    if (!this.ready) {
      this.pendingInit = message;
      return;
    }
    void this.panel.webview.postMessage(message);
  }

  private handleMessage(message: WebviewToExtension): void {
    switch (message.type) {
      case "ready":
        this.ready = true;
        if (this.pendingInit) {
          void this.panel.webview.postMessage(this.pendingInit);
          this.pendingInit = null;
        }
        return;
      case "change":
        this.handlers.onChange?.(message.layout);
        return;
      case "connectionCreate":
        this.handlers.onConnectionCreate?.(message.fromKey, message.toKey);
        return;
      case "selectionChange":
        this.handlers.onSelectionChange?.(message.keys);
        return;
      case "error":
        void vscode.window.showWarningMessage(
          `Modelica diagram: ${message.message}`,
        );
        return;
    }
  }

  private renderHtml(): string {
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webview.js"),
    );
    const nonce = randomNonce();
    const csp = [
      `default-src 'none'`,
      `script-src 'nonce-${nonce}'`,
      `style-src ${this.panel.webview.cspSource} 'unsafe-inline'`,
      `img-src ${this.panel.webview.cspSource} data: blob:`,
      `font-src ${this.panel.webview.cspSource} data:`,
    ].join("; ");
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>Modelica diagram: ${this.escapeHtml(this.className)}</title>
    <style>
      html, body { margin: 0; height: 100%; background: #f7f7f8; }
      om-graphical-layout { width: 100%; height: 100%; display: block; }
    </style>
  </head>
  <body>
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}

function randomNonce(): string {
  let s = "";
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}
