/**
 * Package lifecycle commands:
 * - `modelica.createPackage` — in-memory package via loadString.
 * - `modelica.savePackage` — Option-B persistence (listFile → write → setSourceFile).
 */

import * as vscode from "vscode";
import { writeFile } from "node:fs/promises";

import type { LibraryNode } from "../tree/library-tree.js";

import {
  parentFromNode,
  runLoadString,
  validateIdentifier,
  type CommandContext,
} from "./context.js";

export function registerPackageCommands(ctx: CommandContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(
      "modelica.createPackage",
      async (node?: LibraryNode) => {
        const parent = parentFromNode(node);
        const name = await vscode.window.showInputBox({
          prompt: parent ? `New package inside ${parent}` : "New top-level package",
          placeHolder: "MyPackage",
          validateInput: validateIdentifier,
        });
        if (!name) return;
        const qualified = parent ? `${parent}.${name}` : name;
        const data = parent
          ? `within ${parent};\npackage ${name}\nend ${name};\n`
          : `package ${name}\nend ${name};\n`;
        await runLoadString(ctx, data, qualified, "Modelica: failed to create");
      },
    ),
    vscode.commands.registerCommand(
      "modelica.savePackage",
      async (node?: LibraryNode) => {
        if (!node) {
          await vscode.window.showWarningMessage(
            "Modelica: Save Package must be invoked from a tree node.",
          );
          return;
        }
        const defaultUri = (() => {
          const ws = vscode.workspace.workspaceFolders?.[0];
          const fileName = `${node.displayName}.mo`;
          return ws
            ? vscode.Uri.joinPath(ws.uri, fileName)
            : vscode.Uri.file(fileName);
        })();
        const target = await vscode.window.showSaveDialog({
          defaultUri,
          filters: { Modelica: ["mo"] },
          saveLabel: "Save",
          title: `Save ${node.qualifiedName} as`,
        });
        if (!target) return;
        try {
          const c = await ctx.ensureClient();
          const { contents } = await c.listFile({ typeName: node.qualifiedName });
          await writeFile(target.fsPath, contents, "utf8");
          await c.setSourceFile({
            typeName: node.qualifiedName,
            fileName: target.fsPath,
          });
          ctx.libraryTree.refresh();
          await vscode.window.showInformationMessage(
            `Modelica: saved ${node.qualifiedName} to ${target.fsPath}`,
          );
        } catch (err) {
          await vscode.window.showErrorMessage(
            `Modelica: savePackage failed: ${(err as Error).message}`,
          );
        }
      },
    ),
  ];
}
