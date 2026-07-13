import * as vscode from "vscode";

/**
 * Context key gating the diagram's single-letter keybindings (`r`/`f`/Delete)
 * so they only fire over the canvas, never while typing in a modal. The active
 * diagram surface mirrors its webview's editable-field focus into this key.
 */
const INPUT_FOCUS_CONTEXT = "modelicaDiagramInputFocus";

export function setInputFocusContext(focused: boolean): void {
  void vscode.commands.executeCommand(
    "setContext",
    INPUT_FOCUS_CONTEXT,
    focused,
  );
}
