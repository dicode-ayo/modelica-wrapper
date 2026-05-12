/**
 * `modelica.getOmcVersion` — quick "is OMC alive" smoke test.
 */

import * as vscode from "vscode";

import type { CommandContext } from "./context.js";

export function registerOmcCommands(ctx: CommandContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("modelica.getOmcVersion", async () => {
      try {
        const c = await ctx.ensureClient();
        const { version } = await c.getVersion();
        await vscode.window.showInformationMessage(version);
      } catch (err) {
        await vscode.window.showErrorMessage(`OMC: ${(err as Error).message}`);
      }
    }),
  ];
}
