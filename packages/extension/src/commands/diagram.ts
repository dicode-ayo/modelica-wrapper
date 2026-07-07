/**
 * Diagram + source-view commands:
 * - `modelica.openDiagram(arg)` — open a class in the diagram webview.
 * - `modelica.diagram.undo()` — diagram-local snapshot undo (issue #29).
 * - `modelica.viewSource(node?)` — open the `modelica-source://` view.
 * - `modelica.openDiagramFromSource()` — title-bar action on source tabs.
 */

import * as vscode from "vscode";

import { openDiagram } from "../diagram/open-diagram.js";
import { DiagramPanel } from "../diagram/panel.js";
import { qualifiedNameFromUri, sourceUriFor } from "../source-provider.js";
import type { LibraryNode } from "../tree/library-tree.js";
import type { DiagramCommandId } from "../webview/protocol.js";

import type { CommandContext } from "./context.js";

/**
 * VSCode command id → diagram command id. These are bound as keybindings
 * (`when: activeWebviewPanelId == modelicaDiagram && !modelicaDiagramInputFocus`)
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
  ctx: CommandContext,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("modelica.openDiagram", async (arg) => {
      try {
        const c = await ctx.ensureClient();
        await openDiagram(ctx.extensionContext, c, arg);
      } catch (err) {
        await vscode.window.showErrorMessage(
          `Modelica: openDiagram failed: ${(err as Error).message}`,
        );
      }
    }),
    vscode.commands.registerCommand("modelica.diagram.undo", async () => {
      // Routes to the active diagram panel's diagram-local undo handler
      // (issue #29) — the same path the toolbar Undo button fires. We do NOT
      // hijack native Ctrl-Z: diagram edits never touch a TextDocument, so a
      // global undo binding would fight the editor. The command is scoped to
      // the diagram webview via its `when` clause in package.json.
      if (!DiagramPanel.undoActive()) {
        await vscode.window.showWarningMessage(
          "Modelica: no active diagram to undo (focus a diagram first).",
        );
      }
    }),
    ...SELECTION_COMMANDS.map(([vscodeId, diagramId]) =>
      vscode.commands.registerCommand(vscodeId, async () => {
        if (!DiagramPanel.runActiveCommand(diagramId)) {
          await vscode.window.showWarningMessage(
            "Modelica: no active diagram (focus a diagram first).",
          );
        }
      }),
    ),
    vscode.commands.registerCommand(
      "modelica.viewSource",
      async (node?: LibraryNode) => {
        const typeName = node?.qualifiedName ?? DiagramPanel.activeClassName();
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
