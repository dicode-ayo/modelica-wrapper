/**
 * `modelica.tree.refresh` — re-fetch the libraries tree.
 */

import * as vscode from "vscode";

import type { CommandContext } from "./context.js";

export function registerTreeCommands(ctx: CommandContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("modelica.tree.refresh", () => {
      ctx.libraryTree.refresh();
    }),
  ];
}
