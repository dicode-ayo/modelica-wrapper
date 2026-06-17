/**
 * `modelica.savePackage` — Option-B persistence: read the class source via
 * `listFile`, write it to disk ourselves, then tell OMC where it now lives
 * with `setSourceFile`. Works on any package or library node.
 *
 * `modelica.initializeWorkspaceAsPackage` — Create a root `package.mo` in the
 * open workspace folder, making the folder itself a named package. Follows the
 * OMEdit convention so children written later nest correctly under the package.
 */

import * as path from "node:path";
import { writeFile } from "node:fs/promises";

import * as vscode from "vscode";

import type { LibraryNode } from "../tree/library-tree.js";

import {
  sanitizeIdentifier,
  validateIdentifier,
  type CommandContext,
} from "./context.js";
import { createReplLog } from "./repl.js";

export function registerPackageCommands(
  ctx: CommandContext,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(
      "modelica.initializeWorkspaceAsPackage",
      async () => {
        const ws = vscode.workspace.workspaceFolders?.[0];
        if (!ws) {
          await vscode.window.showWarningMessage(
            "Modelica: Open a folder first to initialize it as a package.",
          );
          return;
        }
        const folderDefault = sanitizeIdentifier(path.basename(ws.uri.fsPath));
        const pkgName = await vscode.window.showInputBox({
          prompt: "Package name for the workspace root",
          value: folderDefault,
          validateInput: validateIdentifier,
        });
        if (!pkgName) return;
        const pkgFile = vscode.Uri.joinPath(ws.uri, "package.mo").fsPath;
        const log = createReplLog(`initializeWorkspaceAsPackage ${pkgName}`);
        try {
          const pkgBody = `package ${pkgName}\nend ${pkgName};\n`;
          const c = await ctx.ensureClient();
          const { success } = await c.loadString({
            data: pkgBody,
            filename: pkgFile,
            merge: true,
          });
          if (!success) {
            const { errorString } = await c.getErrorString();
            log.error(errorString || "loadString returned success=false");
            await vscode.window.showErrorMessage(
              `Modelica: failed to initialize workspace package${errorString ? `: ${errorString}` : ""}`,
            );
            return;
          }
          await writeFile(pkgFile, pkgBody, "utf8");
          await c.setSourceFile({ typeName: pkgName, fileName: pkgFile });
          ctx.libraryTree.refresh();
          ctx.sourceProvider.notifySourceChanged();
          log.success(`initialized ${ws.uri.fsPath} as package ${pkgName}`);
          await vscode.window.showInformationMessage(
            `Modelica: workspace initialized as package "${pkgName}"`,
          );
        } catch (err) {
          log.error((err as Error).message);
          await vscode.window.showErrorMessage(
            `Modelica: initializeWorkspaceAsPackage failed: ${(err as Error).message}`,
          );
        }
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
        const log = createReplLog(`savePackage ${node.qualifiedName}`);
        try {
          const c = await ctx.ensureClient();
          const { contents } = await c.listFile({
            typeName: node.qualifiedName,
          });
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
