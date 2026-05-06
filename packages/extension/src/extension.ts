/**
 * VSCode extension entry point.
 *
 * The OMC client is created lazily on first command use so we don't pay the
 * 1–3 s OMC startup cost for users who open the editor without using
 * Modelica features.
 */

import * as vscode from "vscode";

import { OmcClient } from "@modelica-wrapper/omc-client";

let client: OmcClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(
    vscode.commands.registerCommand("modelica.getOmcVersion", async () => {
      try {
        const c = await ensureClient();
        const { version } = await c.getVersion();
        await vscode.window.showInformationMessage(version);
      } catch (err) {
        await vscode.window.showErrorMessage(`OMC: ${(err as Error).message}`);
      }
    }),
  );
}

export async function deactivate(): Promise<void> {
  if (client) {
    const c = client;
    client = undefined;
    await c.close();
  }
}

async function ensureClient(): Promise<OmcClient> {
  if (client) return client;
  const cfg = vscode.workspace.getConfiguration("modelica");
  const omcPath = cfg.get<string>("omcPath") ?? "";
  client = await OmcClient.create({ omcPath });
  return client;
}
