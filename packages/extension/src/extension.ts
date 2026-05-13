/**
 * VSCode extension entry point.
 *
 * The OMC client is created lazily on first command use so we don't pay the
 * 1–3 s OMC startup cost for users who open the editor without using
 * Modelica features. Per-command logic lives in `./commands/*`.
 *
 * On activation we scan the workspace folder(s) and load any top-level
 * `.mo` file or `<dir>/package.mo` found, with `uses=true` so referenced
 * libraries (via `uses(...)` annotations) come along. This makes opening a
 * Modelica project feel like opening any other source folder — no manual
 * Load Library step required.
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
import { discoverEntryPoints } from "./workspace-scan.js";

let client: OmcClient | undefined;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
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
    vscode.workspace.registerFileSystemProvider(
      MODELICA_SOURCE_SCHEME,
      sourceProvider,
      { isCaseSensitive: true },
    ),
    ...registerCommands({
      extensionContext: context,
      ensureClient,
      libraryTree,
      sourceProvider,
      diagnostics,
    }),
  );

  // Non-blocking — we don't want to delay activation on OMC startup.
  void autoLoadWorkspaceModels(libraryTree);
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

/**
 * Discover Modelica entry points in each workspace folder and `loadFile`
 * them. Three cases per folder, in order:
 *   1. `<root>/package.mo` — the workspace IS a package, load just that.
 *   2. Otherwise, every top-level `<root>/*.mo` standalone file.
 *   3. Every top-level `<root>/<dir>/package.mo` (subdirectory packages).
 *
 * `uses=true` (the default for `loadFile`) walks `uses(...)` annotations to
 * pull in dependent libraries from MODELICAPATH. Failures are logged but
 * don't abort the whole sweep — one bad file shouldn't block others.
 */
async function autoLoadWorkspaceModels(
  libraryTree: LibraryTreeProvider,
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return;
  const files = await discoverEntryPoints(folders.map((f) => f.uri.fsPath));
  if (files.length === 0) {
    return;
  }
  try {
    const c = await ensureClient();
    for (const fileName of files) {
      try {
        const { success } = await c.loadFile({ fileName });
        if (!success) {
          const { errorString } = await c.getErrorString();
          log.warn("autoLoad", `loadFile failed: ${fileName}: ${errorString}`);
        } else {
          log.info("autoLoad", `loaded ${fileName}`);
        }
      } catch (err) {
        log.warn(
          "autoLoad",
          `loadFile threw for ${fileName}: ${(err as Error).message}`,
        );
      }
    }
    libraryTree.refresh();
  } catch (err) {
    log.warn("autoLoad", `OMC client unavailable: ${(err as Error).message}`);
  }
}

