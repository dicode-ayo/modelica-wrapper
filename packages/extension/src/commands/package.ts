/**
 * `modelica.savePackage` — Option-B persistence: read the class source via
 * `listFile`, write it to disk ourselves, then tell OMC where it now lives
 * with `setSourceFile`. Works on any package or library node.
 */

import * as vscode from "vscode";
import { writeFile } from "node:fs/promises";

import type { LibraryNode } from "../tree/library-tree.js";

import type { CommandContext } from "./context.js";
import { createReplLog } from "./repl.js";

export function registerPackageCommands(ctx: CommandContext): vscode.Disposable[] {
  return [
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
        const log = createReplLog(`savePackage ${node.qualifiedName}`);
        try {
          const c = await ctx.ensureClient();
          const { contents } = await c.listFile({ typeName: node.qualifiedName });
          await writeFile(target.fsPath, contents, "utf8");
          await c.setSourceFile({
            typeName: node.qualifiedName,
            fileName: target.fsPath,
          });
          ctx.libraryTree.refresh();
          log.success(`saved to ${target.fsPath}`);
          await vscode.window.showInformationMessage(
            `Modelica: saved ${node.qualifiedName} to ${target.fsPath}`,
          );
        } catch (err) {
          log.error((err as Error).message);
          await vscode.window.showErrorMessage(
            `Modelica: savePackage failed: ${(err as Error).message}`,
          );
        }
      },
    ),
  ];
}
