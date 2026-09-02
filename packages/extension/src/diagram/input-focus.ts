import * as vscode from "vscode";

/**
 * Context key gating the diagram's single-letter keybindings (`r`/`f`/Delete)
 * so they only fire over the canvas, never while typing in a modal. The active
 * diagram surface mirrors into this key whether its webview's focus rests in
 * an editable field or anywhere in the parameters panel.
 */
const INPUT_FOCUS_CONTEXT = "modelicaDiagramInputFocus";

export function setInputFocusContext(focused: boolean): void {
  void vscode.commands.executeCommand(
    "setContext",
    INPUT_FOCUS_CONTEXT,
    focused,
  );
}
