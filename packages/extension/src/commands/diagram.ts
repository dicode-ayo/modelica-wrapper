/**
 * Diagram + source-view commands:
 * - `modelica.openDiagram(arg)` — open a class in the diagram custom editor.
 * - `modelica.openAsText` / `openAsIcon` / `openAsDiagram` /
 *   `openAsDocumentation` — the title-bar view switcher: flip the active editor
 *   between the class's text, icon, diagram, and documentation views in place
 *   (closing the tab it came from).
 * - `modelica.viewSource(node?)` — open the `modelica-source:` text view for a
 *   class (e.g. from a library-tree node).
 * - `modelica.openDiagramFromSource()` — open the diagram from a source tab.
 */

import * as vscode from "vscode";

import { DiagramEditorProvider } from "../diagram/diagram-editor-provider.js";
import { openDiagram } from "../diagram/open-diagram.js";
import {
  DIAGRAM_VIEW_TYPE,
  DOCUMENTATION_VIEW_TYPE,
  ICON_VIEW_TYPE,
} from "../diagram/view-type.js";
import { DocumentationEditorProvider } from "../documentation/documentation-editor-provider.js";
import { qualifiedNameFromUri, sourceUriFor } from "../source-provider.js";
import type { DiagramCommandId } from "../webview/protocol.js";

import type { CommandContext, LibraryNode } from "./context.js";

/** The built-in text editor id — the `openWith` override for the text view. */
const TEXT_VIEW = "default";

/**
 * Resolve the Modelica class the active editor is showing: the focused
 * diagram/icon custom editor if there is one, else the active
 * `modelica-source:` text editor.
 */
function activeClass(): string | undefined {
  const fromCustom =
    DiagramEditorProvider.activeClassName() ??
    DocumentationEditorProvider.activeClassName();
  if (fromCustom) return fromCustom;
  const uri = vscode.window.activeTextEditor?.document.uri;
  return uri ? qualifiedNameFromUri(uri) : undefined;
}

function tabUri(tab: vscode.Tab): vscode.Uri | undefined {
  const input = tab.input;
  if (input instanceof vscode.TabInputText) return input.uri;
  if (input instanceof vscode.TabInputCustom) return input.uri;
  return undefined;
}

/**
 * Flip the active editor to another view (`target` is a custom-editor viewType
 * or the text-editor id) of the same class. Closes any other view of the same
 * class, so the views toggle in place rather than accumulating a tab per
 * representation. The tabs to close are re-derived from the fresh tab list
 * after the switch — a `vscode.Tab` is a snapshot, and VSCode reuses the tab
 * input in place for preview editors, so a pre-switch handle can go stale and
 * name the freshly-switched editor.
 */
export async function switchView(target: string): Promise<void> {
  const className = activeClass();
  if (!className) {
    await vscode.window.showWarningMessage(
      "Modelica: no Modelica class in the active editor.",
    );
    return;
  }
  const uri = sourceUriFor(className);
  await vscode.commands.executeCommand("vscode.openWith", uri, target);
  const isTargetView = (tab: vscode.Tab): boolean =>
    target === TEXT_VIEW
      ? tab.input instanceof vscode.TabInputText
      : tab.input instanceof vscode.TabInputCustom &&
        tab.input.viewType === target;
  const stale = vscode.window.tabGroups.activeTabGroup.tabs.filter(
    (tab) => tabUri(tab)?.toString() === uri.toString() && !isTargetView(tab),
  );
  if (stale.length > 0) await vscode.window.tabGroups.close(stale);
}

/**
 * VSCode command id → diagram command id. These are bound as keybindings
 * gated on a focused diagram or icon custom editor and forwarded into that
 * webview, so the shortcuts live in VSCode's keymap and are remappable from
 * the Keyboard Shortcuts UI.
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
    vscode.commands.registerCommand("modelica.openAsText", () =>
      switchView(TEXT_VIEW),
    ),
    vscode.commands.registerCommand("modelica.openAsIcon", () =>
      switchView(ICON_VIEW_TYPE),
    ),
    vscode.commands.registerCommand("modelica.openAsDiagram", () =>
      switchView(DIAGRAM_VIEW_TYPE),
    ),
    vscode.commands.registerCommand("modelica.openAsDocumentation", () =>
      switchView(DOCUMENTATION_VIEW_TYPE),
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
