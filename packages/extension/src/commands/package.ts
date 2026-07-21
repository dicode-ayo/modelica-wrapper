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

import * as vscode from "vscode";

import type { SelfWriteGuard } from "../self-write-guard.js";

import {
  sanitizeIdentifier,
  validateIdentifier,
  type CommandContext,
  type LibraryNode,
} from "./context.js";
import { createReplLog } from "./repl.js";

interface PkgInitClient {
  loadString(i: {
    data: string;
    filename: string;
    merge: boolean;
  }): Promise<{ success: boolean }>;
  getErrorString(): Promise<{ errorString: string }>;
  setSourceFile(i: { typeName: string; fileName: string }): Promise<unknown>;
}

type PkgInitResult =
  | { success: true; pkgFile: string }
  | { success: false; errorString: string };

/**
 * loadString + writeFile + setSourceFile for a workspace-root `package.mo`.
 * Callers own logging and the VS Code error toast; this function owns OMC and
 * disk state. The result discriminates OMC rejection from thrown errors so
 * callers can surface an accurate message either way.
 */
export async function loadRootPackage(
  client: PkgInitClient,
  wsUri: vscode.Uri,
  pkgName: string,
  guard: SelfWriteGuard,
): Promise<PkgInitResult> {
  const pkgFile = vscode.Uri.joinPath(wsUri, "package.mo").fsPath;
  const pkgBody = `package ${pkgName}\nend ${pkgName};\n`;
  const { success } = await client.loadString({
    data: pkgBody,
    filename: pkgFile,
    merge: true,
  });
  if (!success) {
    const { errorString } = await client.getErrorString();
    return {
      success: false,
      errorString: errorString || "loadString returned success=false",
    };
  }
  await guard.write(pkgFile, pkgBody);
  await client.setSourceFile({ typeName: pkgName, fileName: pkgFile });
  return { success: true, pkgFile };
}

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
        const log = createReplLog(`initializeWorkspaceAsPackage ${pkgName}`);
        try {
          const c = await ctx.ensureClient();
          const result = await loadRootPackage(
            c,
            ws.uri,
            pkgName,
            ctx.selfWriteGuard,
          );
          if (!result.success) {
            log.error(result.errorString);
            await vscode.window.showErrorMessage(
              `Modelica: failed to initialize workspace package: ${result.errorString}`,
            );
            return;
          }
          ctx.libraryTree.childrenChanged(null);
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
          await ctx.selfWriteGuard.write(target.fsPath, contents);
          await c.setSourceFile({
            typeName: node.qualifiedName,
            fileName: target.fsPath,
          });
          // The tree itself shows nothing new, but the source provider's
          // cached disk path/read-only verdict for this class is now stale —
          // invalidate so a later editor save writes through to `target`.
          ctx.sourceProvider.notifySourceChanged(node.qualifiedName);
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
