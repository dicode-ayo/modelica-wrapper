import * as vscode from "vscode";
import type {
  ClassDef,
  DiagramLayout,
  ParameterModel,
} from "@dicode/omc-client";

import type {
  DiagramCommandId,
  ExtensionToWebview,
  WebviewToExtension,
} from "../webview/protocol.js";
import { createReadyGate, type ReadyGate } from "../webview/ready-gate.js";
import { renderDiagramWebviewHtml } from "./diagram-webview-html.js";
import { setInputFocusContext } from "./input-focus.js";

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
   * User dropped or placed a class on the canvas. `position` is the drop point
   * in diagram coordinates — the host turns it into a Placement annotation for
   * `addComponent`.
   */
  onAddComponent?: (
    className: string,
    position: { x: number; y: number },
  ) => void;
  /**
   * User triggered "Change class" on a selected component. The host shows
   * an input prompt, calls `setElementType`, and refreshes the layout.
   */
  onChangeClassRequest?: (componentName: string, currentClass: string) => void;
}

export interface OpenParametersOptions {
  /** Opaque tag echoed back on submit/cancel so the host can route. */
  kind: string;
  /** The typed parameter model the form renders (fields carry their values). */
  model: ParameterModel;
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
  private readonly gate: ReadyGate;
  /** Whether this panel's webview last reported an editable field focused. */
  private inputFocused = false;

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
    this.gate = createReadyGate(this.panel.webview);
    this.panel.webview.html = this.renderHtml();
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((m) => this.handleMessage(m)),
    );
    this.disposables.push(
      this.panel.onDidChangeViewState((e) => {
        if (e.webviewPanel.active) {
          DiagramPanel.activePanel = this;
          // A panel blur/refocus doesn't round-trip through the iframe's
          // focusin/focusout, so the webview can't re-announce focus on the
          // way back. This panel's last-known state is the source of truth.
          setInputFocusContext(this.inputFocused);
        } else if (DiagramPanel.activePanel === this) {
          DiagramPanel.activePanel = undefined;
        }
      }),
    );
    this.disposables.push(this.panel.onDidDispose(() => this.dispose()));
    DiagramPanel.activePanel = this;
    this.send({ type: "init", layout: this.layout, className: this.className });
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
    const panel = new DiagramPanel(className, layout, extensionUri, handlers);
    DiagramPanel.panels.set(className, panel);
    return panel;
  }

  update(layout: DiagramLayout): void {
    this.layout = layout;
    this.send({ type: "layout", layout });
  }

  /**
   * Push a diagram command (resolved from a VSCode keybinding) into the active
   * panel's webview. Returns `false` when no diagram panel is focused so the
   * command can surface a hint, mirroring {@link undoActive}.
   */
  static runActiveCommand(commandId: DiagramCommandId): boolean {
    const panel = DiagramPanel.activePanel;
    if (!panel) return false;
    panel.send({ type: "runCommand", commandId });
    return true;
  }

  /**
   * Relay a placement gesture from the library sidebar to the active diagram.
   * `className !== null` arms placement; `null` cancels it. Returns `false`
   * when no diagram panel is active so the caller can no-op quietly.
   */
  static relayPlacement(className: string | null): boolean {
    const panel = DiagramPanel.activePanel;
    if (!panel) return false;
    panel.send(
      className === null
        ? { type: "placementCancel" }
        : { type: "placementStart", className },
    );
    return true;
  }

  /** Relay the armed class's resolved definition so the diagram can upgrade the
   *  crosshair to the real preview node. No-op when no panel is active. */
  static relayPlacementPreview(className: string, classDef: ClassDef): boolean {
    const panel = DiagramPanel.activePanel;
    if (!panel) return false;
    panel.send({ type: "placementPreview", className, classDef });
    return true;
  }

  /** Tell the webview to open its parameter modal with this model. */
  openParameters(opts: OpenParametersOptions): void {
    const msg: ExtensionToWebview = {
      type: "parametersOpen",
      kind: opts.kind,
      model: opts.model,
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
      setInputFocusContext(false);
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
    this.gate.send(message);
  }

  private handleMessage(message: WebviewToExtension): void {
    switch (message.type) {
      case "ready":
        this.gate.markReady();
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
      case "inputFocus":
        this.inputFocused = message.focused;
        if (DiagramPanel.activePanel === this) {
          setInputFocusContext(message.focused);
        }
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
      case "changeClassRequest":
        this.handlers.onChangeClassRequest?.(
          message.componentName,
          message.currentClass,
        );
        return;
      case "error":
        void vscode.window.showWarningMessage(
          `Modelica diagram: ${message.message}`,
        );
        return;
    }
  }

  private renderHtml(): string {
    return renderDiagramWebviewHtml(
      this.panel.webview,
      this.extensionUri,
      this.className,
    );
  }
}
