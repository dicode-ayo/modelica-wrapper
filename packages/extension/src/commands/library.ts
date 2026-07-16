/**
 * `modelica.loadLibrary` — prompt for a library name and load it from MODELICAPATH.
 */

import * as vscode from "vscode";

import type { CommandContext } from "./context.js";
import { createReplLog } from "./repl.js";

export function registerLibraryCommands(
  ctx: CommandContext,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("modelica.loadLibrary", async () => {
      const name = await vscode.window.showInputBox({
        prompt: "Library to load (resolved against MODELICAPATH)",
        placeHolder: "Modelica",
        value: "Modelica",
      });
      if (!name) return;
      const log = createReplLog(`loadLibrary ${name}`);
      try {
        const c = await ctx.ensureClient();
        const { success } = await c.loadModel({ typeName: name });
        if (!success) {
          const { errorString } = await c.getErrorString();
          log.error(errorString || "loadModel returned success=false");
          await vscode.window.showErrorMessage(
            `Modelica: failed to load ${name}${errorString ? `: ${errorString}` : ""}`,
          );
          return;
        }
        ctx.libraryTree.childrenChanged(null);
        log.success(`loaded ${name}`);
      } catch (err) {
        log.error((err as Error).message);
        await vscode.window.showErrorMessage(
          `Modelica: loadLibrary failed: ${(err as Error).message}`,
        );
      }
    }),
  ];
}
