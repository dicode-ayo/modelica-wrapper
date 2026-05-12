/**
 * VSCode extension entry point.
 *
 * The OMC client is created lazily on first command use so we don't pay the
 * 1–3 s OMC startup cost for users who open the editor without using
 * Modelica features. Per-command logic lives in `./commands/*`.
 */

import * as vscode from "vscode";

import { OmcClient } from "@modelica-wrapper/omc-client";

import { registerCommands } from "./commands/index.js";
import { log } from "./logger.js";
import {
  MODELICA_SOURCE_SCHEME,
  ModelicaSourceProvider,
} from "./source-provider.js";
import { LibraryTreeProvider } from "./tree/library-tree.js";

let client: OmcClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log.info("activate", "extension activating");
  const libraryTree = new LibraryTreeProvider(ensureClient);
  const libraryView = vscode.window.createTreeView("modelica.libraries", {
    treeDataProvider: libraryTree,
    showCollapseAll: true,
  });

  const sourceProvider = new ModelicaSourceProvider(ensureClient);

  // One DiagnosticCollection shared by the user-triggered Check Model command
  // (clear-all + replace) and the live-check pipeline (per-file updates).
  const diagnostics = vscode.languages.createDiagnosticCollection("modelica");

  context.subscriptions.push(
    libraryView,
    diagnostics,
    vscode.workspace.registerTextDocumentContentProvider(
      MODELICA_SOURCE_SCHEME,
      sourceProvider,
    ),
    ...registerCommands({
      extensionContext: context,
      ensureClient,
      libraryTree,
      sourceProvider,
      diagnostics,
    }),
  );
}

export async function deactivate(): Promise<void> {
  if (client) {
    const c = client;
    client = undefined;
    await c.close();
  }
  log.dispose();
}

async function ensureClient(): Promise<OmcClient> {
  if (client) return client;
  const cfg = vscode.workspace.getConfiguration("modelica");
  const omcPath = cfg.get<string>("omcPath") ?? "";
  client = await OmcClient.create({ omcPath });
  return client;
}
