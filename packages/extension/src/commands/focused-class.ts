import * as vscode from "vscode";

import { DiagramEditorProvider } from "../diagram/diagram-editor-provider.js";
import { DocumentationEditorProvider } from "../documentation/documentation-editor-provider.js";
import { qualifiedNameFromUri } from "../source-provider.js";

/**
 * The Modelica class the focused editor is showing: the diagram custom editor,
 * else the documentation custom editor, else the active `modelica-source:`
 * text editor. Every command that acts on "the current class" resolves it
 * here so a tab kind cannot be recognised by one command and not another.
 */
export function focusedClass(): string | undefined {
  const fromCustom =
    DiagramEditorProvider.activeClassName() ??
    DocumentationEditorProvider.activeClassName();
  if (fromCustom) return fromCustom;
  const uri = vscode.window.activeTextEditor?.document.uri;
  return uri ? qualifiedNameFromUri(uri) : undefined;
}
