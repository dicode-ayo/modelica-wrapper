/**
 * Misc/debug commands:
 * - `modelica.getOmcVersion` — quick "is OMC alive" smoke test.
 * - `modelica.showLogs` — focus the Modelica Output channel.
 */

import * as vscode from "vscode";

import { errorDetail } from "../error-detail.js";
import { log } from "../logger.js";

import type { CommandContext } from "./context.js";

export function registerOmcCommands(ctx: CommandContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("modelica.getOmcVersion", async () => {
      try {
        const c = await ctx.ensureClient();
        const { version } = await c.getVersion();
        await vscode.window.showInformationMessage(version);
      } catch (err) {
        await vscode.window.showErrorMessage(`OMC: ${errorDetail(err)}`);
      }
    }),
    vscode.commands.registerCommand("modelica.showLogs", () => {
      log.show();
    }),
  ];
}
