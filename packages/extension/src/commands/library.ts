/**
 * `modelica.loadLibrary` — prompt for a library name and load it from
 * MODELICAPATH, offering an install from the package index when it is missing.
 */

import * as vscode from "vscode";

import { errorDetail } from "../error-detail.js";

import type { CommandContext } from "./context.js";
import {
  createLibraryLoader,
  displayVersion,
  type LibraryInstallUi,
} from "./library-install.js";
import { createReplLog } from "./repl.js";

const vscodeInstallUi: LibraryInstallUi = {
  confirmInstall: async (name, version) =>
    (await vscode.window.showInformationMessage(
      `Modelica: ${name} is not installed. Install ${name} ${displayVersion(version)}?`,
      "Install",
      "Cancel",
    )) === "Install",
  withProgress: (title, task) =>
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title },
      task,
    ),
};

function withDetail(message: string, detail: string): string {
  return detail ? `${message}: ${detail}` : message;
}

export function registerLibraryCommands(
  ctx: CommandContext,
): vscode.Disposable[] {
  const loadLibrary = createLibraryLoader(vscodeInstallUi);
  return [
    vscode.commands.registerCommand("modelica.loadLibrary", async () => {
      const name = await vscode.window.showInputBox({
        prompt: "Library to load (resolved against MODELICAPATH)",
        placeHolder: "Modelica",
        value: "Modelica",
      });
      if (!name) return;
      const log = createReplLog(`loadLibrary ${name}`);
      const fail = async (message: string, detail: string): Promise<void> => {
        log.error(detail || message);
        await vscode.window.showErrorMessage(withDetail(message, detail));
      };
      try {
        const c = await ctx.ensureClient();
        const result = await loadLibrary(c, name);
        switch (result.kind) {
          case "loaded":
            ctx.libraryTree.childrenChanged(null);
            log.success(`loaded ${name}`);
            return;
          case "installed":
            ctx.libraryTree.childrenChanged(null);
            log.success(`installed and loaded ${name} ${result.version}`);
            return;
          case "loadFailed":
          case "declined":
            await fail(`Modelica: failed to load ${name}`, result.loadError);
            return;
          case "indexUpdateFailed":
            await fail(
              `Modelica: failed to load ${name}; updating the package index failed`,
              result.error,
            );
            return;
          case "installFailed":
            await fail(
              `Modelica: failed to install ${name} ${result.version}`,
              result.error,
            );
            return;
          case "reloadFailed":
            await fail(
              `Modelica: installed ${name} ${result.version} but failed to load it`,
              result.error,
            );
            return;
          case "busy":
            await vscode.window.showInformationMessage(
              `Modelica: ${name} is already being loaded.`,
            );
            return;
        }
      } catch (err) {
        log.error(errorDetail(err));
        await vscode.window.showErrorMessage(
          `Modelica: loadLibrary failed: ${errorDetail(err)}`,
        );
      }
    }),
  ];
}
