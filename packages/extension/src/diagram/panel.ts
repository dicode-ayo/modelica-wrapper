import * as vscode from "vscode";
import type { DiagramLayout, JsonSchema } from "@modelica-wrapper/omc-client";

import type {
  ExtensionToWebview,
  LibraryClassInfo,
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
  onConnectionCreate?: (
    fromKey: string,
    toKey: string,
    waypoints: ReadonlyArray<readonly [number, number]>,
  ) => void;
  onSelectionChange?: (keys: string[]) => void;
  /** Floating action panel — Undo button (diagram-local snapshot undo). */
  onActionUndo?: () => void;
  /** Floating action panel — Check button. */
  onActionCheck?: () => void;
  /** Floating action panel — Simulate button. */
  onActionSimulate?: () => void;
  /** Floating action panel — Parameters button. */
  onActionParameters?: () => void;
  /** Parameter modal submitted; `kind` is whatever was passed to `openParameters`. */
  onParametersSubmit?: (kind: string, values: Record<string, unknown>) => void;
  /** Parameter modal dismissed without submit. */
  onParametersCancel?: (kind: string) => void;
  /**
   * "Reset to defaults" pressed in the component parameter modal. The
   * host bulk-clears `componentName`'s modifiers, then re-fetches and
   * re-opens the modal with the refreshed values.
   */
  onResetComponentParameters?: (componentName: string) => void;
  /** User double-clicked a sub-component on the diagram. */
  onEditComponent?: (componentName: string) => void;
  /**
   * Library-browser request: enumerate child classes of `parent`
   * (null for top-level loaded packages). Return promises resolve into
   * a `libraryChildren` reply; rejections become `{ error: msg }`.
   */
  onLibraryListChildren?: (
    parent: string | null,
  ) => Promise<LibraryClassInfo[]>;
  /** Library-browser request: substring search of loaded class names. */
  onLibrarySearch?: (query: string) => Promise<LibraryClassInfo[]>;
  /**
   * User picked a class in the library browser. `position` is the
   * current view-centre in diagram coordinates — the host turns it
   * into a Placement annotation for `addComponent`.
   */
  onAddComponent?: (
    className: string,
    position: { x: number; y: number },
  ) => void;
}

export interface OpenParametersOptions {
  /** Opaque tag echoed back on submit/cancel so the host can route. */
  kind: string;
  /** JSON Schema 2020-12 describing the form (object schema). */
  schema: JsonSchema;
  /** Initial field values keyed by property name. */
  values: Record<string, unknown>;
  /** Modal title shown at the top of the form. */
  title: string;
  /** Submit-button label; defaults to "Apply" on the form side. */
  submitLabel?: string;
  /**
   * Cref-prefix the form's Dialog.enable evaluator should strip before
   * looking up values — pass the sub-component name for
   * `kind: "componentParams"` so `PI.controllerType` resolves against
   * the form's `controllerType` working value.
   */
  crefPrefix?: string;
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

  /**
   * Trigger the diagram-local undo on the active panel (issue #29). Routes
   * to the same `onActionUndo` handler the toolbar Undo button fires, so the
   * `modelica.diagram.undo` command and the button share one code path.
   *
   * Returns `false` (no-op) when there's no active diagram panel — the
   * command surfaces a hint to the user in that case.
   */
  static undoActive(): boolean {
    const panel = DiagramPanel.activePanel;
    if (!panel?.handlers.onActionUndo) return false;
    panel.handlers.onActionUndo();
    return true;
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

  /** Tell the webview to open its parameter modal with this schema. */
  openParameters(opts: OpenParametersOptions): void {
    const msg: ExtensionToWebview = {
      type: "parametersOpen",
      kind: opts.kind,
      schema: opts.schema,
      values: opts.values,
      title: opts.title,
    };
    if (opts.submitLabel !== undefined) {
      msg.submitLabel = opts.submitLabel;
    }
    if (opts.crefPrefix !== undefined) {
      msg.crefPrefix = opts.crefPrefix;
    }
    this.send(msg);
  }

  /** Tell the webview to dismiss the parameter modal. */
  closeParameters(): void {
    this.send({ type: "parametersClose" });
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
        this.handlers.onConnectionCreate?.(
          message.fromKey,
          message.toKey,
          message.waypoints,
        );
        return;
      case "selectionChange":
        this.handlers.onSelectionChange?.(message.keys);
        return;
      case "actionUndo":
        this.handlers.onActionUndo?.();
        return;
      case "actionCheck":
        this.handlers.onActionCheck?.();
        return;
      case "actionSimulate":
        this.handlers.onActionSimulate?.();
        return;
      case "actionParameters":
        this.handlers.onActionParameters?.();
        return;
      case "parametersSubmit":
        this.handlers.onParametersSubmit?.(message.kind, message.values);
        return;
      case "parametersCancel":
        this.handlers.onParametersCancel?.(message.kind);
        return;
      case "resetComponentParameters":
        this.handlers.onResetComponentParameters?.(message.componentName);
        return;
      case "addComponent":
        this.handlers.onAddComponent?.(message.className, message.position);
        return;
      case "editComponent":
        this.handlers.onEditComponent?.(message.componentName);
        return;
      case "libraryListChildren":
        void this.handleLibraryRequest(
          message.requestId,
          "libraryChildren",
          () =>
            this.handlers.onLibraryListChildren?.(message.parent) ??
            Promise.resolve([]),
        );
        return;
      case "librarySearch":
        void this.handleLibraryRequest(
          message.requestId,
          "librarySearchResult",
          () =>
            this.handlers.onLibrarySearch?.(message.query) ??
            Promise.resolve([]),
        );
        return;
      case "error":
        void vscode.window.showWarningMessage(
          `Modelica diagram: ${message.message}`,
        );
        return;
    }
  }

  /**
   * Drive a library-browser request: run the provided async fetcher
   * and post the matching response message with either `items` (on
   * success) or `error` (on rejection). Errors are surfaced via the
   * data-source's reject path; the host doesn't pop a toast because
   * the browser already renders an inline error state.
   */
  private async handleLibraryRequest(
    requestId: string,
    responseType: "libraryChildren" | "librarySearchResult",
    fetch: () => Promise<LibraryClassInfo[]>,
  ): Promise<void> {
    try {
      const items = await fetch();
      this.send({ type: responseType, requestId, items });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.send({ type: responseType, requestId, error: msg });
    }
  }

  private renderHtml(): string {
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webview.js"),
    );
    // esbuild collects every `import "*.css"` in the webview bundle
    // (Web Awesome's theme + our vscode bridge) into a sibling
    // `webview.css`. We <link> to it via the webview's cspSource.
    const stylesUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webview.css"),
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
    <link rel="stylesheet" href="${stylesUri}" />
    <style>
      html, body { margin: 0; height: 100%; background: #f7f7f8; overflow: hidden; }
    </style>
  </head>
  <body>
    <om-webview-root></om-webview-root>
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
