/**
 * `modelica.loadLibrary` — prompt for a library name and load it from MODELICAPATH.
 */

import * as vscode from "vscode";

import type { CommandContext } from "./context.js";

export function registerLibraryCommands(ctx: CommandContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("modelica.loadLibrary", async () => {
      const name = await vscode.window.showInputBox({
        prompt: "Library to load (resolved against MODELICAPATH)",
        placeHolder: "Modelica",
        value: "Modelica",
      });
      if (!name) return;
      try {
        const c = await ctx.ensureClient();
        const { success } = await c.loadModel({ typeName: name });
        if (!success) {
          const { errorString } = await c.getErrorString();
          await vscode.window.showErrorMessage(
            `Modelica: failed to load ${name}${errorString ? `: ${errorString}` : ""}`,
          );
          return;
        }
        ctx.libraryTree.refresh();
      } catch (err) {
        await vscode.window.showErrorMessage(
          `Modelica: loadLibrary failed: ${(err as Error).message}`,
        );
      }
    }),
  ];
}
