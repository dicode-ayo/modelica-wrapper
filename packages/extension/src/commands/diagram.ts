/**
 * Diagram + source-view commands:
 * - `modelica.openDiagram(arg)` — open a class in the diagram custom editor.
 * - `modelica.viewSource(node?)` — open the `modelica-source://` view.
 * - `modelica.openDiagramFromSource()` — title-bar action on source tabs.
 */

import * as vscode from "vscode";

import { DiagramEditorProvider } from "../diagram/diagram-editor-provider.js";
import { openDiagram } from "../diagram/open-diagram.js";
import { qualifiedNameFromUri, sourceUriFor } from "../source-provider.js";
import type { DiagramCommandId } from "../webview/protocol.js";

import type { CommandContext, LibraryNode } from "./context.js";

/**
 * VSCode command id → diagram command id. These are bound as keybindings
 * (`when: activeCustomEditorId == modelica.diagram && !modelicaDiagramInputFocus`)
 * and forwarded into the focused diagram webview, so the diagram shortcuts
 * live in VSCode's keymap and are remappable from the Keyboard Shortcuts UI.
 */
const SELECTION_COMMANDS: ReadonlyArray<readonly [string, DiagramCommandId]> = [
  ["modelica.diagram.delete", "diagram.delete"],
  ["modelica.diagram.rotateCw", "diagram.rotateCw"],
  ["modelica.diagram.rotateCcw", "diagram.rotateCcw"],
  ["modelica.diagram.flipHorizontal", "diagram.flipHorizontal"],
  ["modelica.diagram.flipVertical", "diagram.flipVertical"],
];

export function registerDiagramCommands(
  _ctx: CommandContext,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("modelica.openDiagram", async (arg) => {
      try {
        await openDiagram(arg);
      } catch (err) {
        await vscode.window.showErrorMessage(
          `Modelica: openDiagram failed: ${(err as Error).message}`,
        );
      }
    }),
    ...SELECTION_COMMANDS.map(([vscodeId, diagramId]) =>
      vscode.commands.registerCommand(vscodeId, async () => {
        if (!DiagramEditorProvider.runActiveCommand(diagramId)) {
          await vscode.window.showWarningMessage(
            "Modelica: no active diagram (focus a diagram first).",
          );
        }
      }),
    ),
    vscode.commands.registerCommand(
      "modelica.viewSource",
      async (node?: LibraryNode) => {
        const typeName =
          node?.qualifiedName ?? DiagramEditorProvider.activeClassName();
        if (!typeName) {
          await vscode.window.showWarningMessage(
            "Modelica: no class selected. Right-click a class in the tree or focus an open diagram first.",
          );
          return;
        }
        const doc = await vscode.workspace.openTextDocument(
          sourceUriFor(typeName),
        );
        await vscode.window.showTextDocument(doc, { preview: false });
      },
    ),
    vscode.commands.registerCommand(
      "modelica.openDiagramFromSource",
      async () => {
        const uri = vscode.window.activeTextEditor?.document.uri;
        const typeName = uri ? qualifiedNameFromUri(uri) : undefined;
        if (!typeName) {
          await vscode.window.showWarningMessage(
            "Modelica: not a Modelica source document.",
          );
          return;
        }
        await vscode.commands.executeCommand("modelica.openDiagram", typeName);
      },
    ),
  ];
}
