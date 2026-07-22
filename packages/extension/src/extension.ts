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

import { OmcClient } from "@dicode/omc-client";

import { registerCommands } from "./commands/index.js";
import { DiagramEditorProvider } from "./diagram/diagram-editor-provider.js";
import {
  DIAGRAM_VIEW_TYPE,
  DOCUMENTATION_VIEW_TYPE,
  ICON_VIEW_TYPE,
} from "./diagram/view-type.js";
import {
  DocumentationEditorProvider,
  notifyDocumentationChanged,
} from "./documentation/documentation-editor-provider.js";
import {
  DocumentationHtmlProvider,
  MODELICA_DOC_SCHEME,
  wireDocHtmlRefresh,
} from "./documentation/documentation-html-provider.js";
import { registerLanguageFeatures } from "./language/index.js";
import { log } from "./logger.js";
import { recoverRestoredCustomEditors } from "./restore-recovery.js";
import { ResultViewEditorProvider } from "./results/result-view-provider.js";
import { evalLine } from "./repl/repl-eval.js";
import {
  MODELICA_SOURCE_SCHEME,
  ModelicaSourceProvider,
} from "./source-provider.js";
import { registerMoFileWatcher } from "./mo-file-watcher.js";
import { createOmcClientCache } from "./omc-client-cache.js";
import { createSelfWriteGuard } from "./self-write-guard.js";
import { syncIconsWithSource } from "./source-icon-sync.js";
import { LibraryWebviewProvider } from "./library/library-webview-provider.js";
import { WORKSPACE_CACHE_DIRNAME } from "./workspace-cache.js";
import { loadEntryFilesAndRefresh } from "./workspace-autoload.js";
import { discoverEntryPoints } from "./workspace-scan.js";

const omcClientCache = createOmcClientCache(
  async () => {
    const cfg = vscode.workspace.getConfiguration("modelica");
    const omcPath = cfg.get<string>("omcPath") ?? "";
    const c = await OmcClient.create({ omcPath });
    await cdIntoWorkspaceCacheDir(c);
    return c;
  },
  (c) => c.close(),
);

/**
 * Public shape returned from `activate()`. Other extensions can reach this
 * via `vscode.extensions.getExtension('drojdestvensky.modelica-wrapper').exports`
 * — only `repl.execute` is exposed today.
 */
export interface ModelicaExtensionApi {
  readonly repl: {
    /** Run a single REPL line (meta-commands and raw OMC). Throws on error. */
    execute: (cmd: string) => Promise<string>;
  };
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<ModelicaExtensionApi> {
  log.info("activate", "extension activating");
  const libraryTree = new LibraryWebviewProvider(
    context.extensionUri,
    ensureClient,
  );
  const libraryView = vscode.window.registerWebviewViewProvider(
    "modelica.libraries",
    libraryTree,
    { webviewOptions: { retainContextWhenHidden: true } },
  );

  const selfWriteGuard = createSelfWriteGuard();
  const sourceProvider = new ModelicaSourceProvider(
    ensureClient,
    selfWriteGuard,
  );
  const docHtmlProvider = new DocumentationHtmlProvider(
    ensureClient,
    (name) => {
      // The webview's controller re-syncs even a dirty buffer through its queue;
      // notifySourceChanged also reloads a plain `.mo` text editor if one is open.
      notifyDocumentationChanged(name);
      sourceProvider.notifySourceChanged(name);
    },
  );

  // One DiagnosticCollection shared by the user-triggered Check Model command
  // (clear-all + replace) and the live-check pipeline (per-file updates).
  const diagnostics = vscode.languages.createDiagnosticCollection("modelica");

  // The virtual filesystem providers must exist before anything else in
  // activation: on window reload VSCode restores the diagram/icon/documentation
  // custom editors and resolves their `modelica-source:` documents through the
  // file service the instant activation is reached. If the scheme has no
  // provider yet, the restore fails with "Unable to resolve resource" and the
  // tab is stuck. Registering these first — ahead of the custom editors and any
  // registration that could throw — keeps the scheme resolvable throughout.
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(
      MODELICA_SOURCE_SCHEME,
      sourceProvider,
      { isCaseSensitive: true },
    ),
    vscode.workspace.registerFileSystemProvider(
      MODELICA_DOC_SCHEME,
      docHtmlProvider,
      { isCaseSensitive: true },
    ),
  );

  // Save-triggered icon refresh. The diagram/icon editors invalidate their own
  // class on an unsaved graphical commit (their `iconChanged` callback below);
  // this is the disjoint path for text-editor saves, which reach the sidebar
  // only through the source provider's change broadcast.
  context.subscriptions.push(syncIconsWithSource(sourceProvider, libraryTree));

  // Keep OMC and the sidebar reactive to bare `.mo` edits (text-editor saves,
  // Explorer/external create/delete) that never pass through a mutation command.
  context.subscriptions.push(
    registerMoFileWatcher({
      ensureClient,
      libraryTree,
      sourceProvider,
      guard: selfWriteGuard,
    }),
  );

  context.subscriptions.push(
    libraryView,
    diagnostics,
    ResultViewEditorProvider.register(context, ensureClient),
    DiagramEditorProvider.register(
      context,
      ensureClient,
      DIAGRAM_VIEW_TYPE,
      "diagram",
      (className) => libraryTree.iconChanged(className),
    ),
    DiagramEditorProvider.register(
      context,
      ensureClient,
      ICON_VIEW_TYPE,
      "icon",
      (className) => libraryTree.iconChanged(className),
    ),
    DocumentationEditorProvider.register(
      context,
      ensureClient,
      DOCUMENTATION_VIEW_TYPE,
    ),
    registerLanguageFeatures(context, ensureClient),
    wireDocHtmlRefresh(docHtmlProvider),
    ...registerCommands({
      extensionContext: context,
      ensureClient,
      resetClient,
      libraryTree,
      sourceProvider,
      diagnostics,
      selfWriteGuard,
    }),
  );

  // Re-open editors VSCode restored before the scheme went live; see the note
  // on `recoverRestoredCustomEditors`.
  void recoverRestoredCustomEditors();

  // Non-blocking — we don't want to delay activation on OMC startup.
  void autoLoadWorkspaceModels(libraryTree);

  // Exported API surface. Tested separately via the `repl-eval` integration
  // suite; the wiring here is just plumbing.
  return {
    repl: {
      execute: async (cmd: string): Promise<string> => {
        const result = await evalLine(cmd, {
          ensureClient,
          resetClient,
        });
        if (result.isError) throw new Error(result.output);
        return result.output;
      },
    },
  };
}

export async function deactivate(): Promise<void> {
  await omcClientCache.close();
  log.dispose();
}

function ensureClient(): Promise<OmcClient> {
  return omcClientCache.ensure();
}

/**
 * Park OMC's working directory in `<workspace>/.modelica/` so all the
 * build artifacts (C files, object files, the simulate executable, the
 * `.mat` result file, …) land in one tidy spot the user can `.gitignore`
 * with a single entry — and DOESN'T pollute their workspace root.
 *
 * Mkdir-recursive the cache dir first so OMC's `cd(...)` doesn't fail
 * with "directory does not exist" on a freshly-opened project. Errors
 * here are non-fatal: we log and let OMC keep its default cwd.
 */
async function cdIntoWorkspaceCacheDir(c: OmcClient): Promise<void> {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) return;
  const path = await import("node:path");
  const fsp = await import("node:fs/promises");
  const cacheDir = path.join(ws.uri.fsPath, WORKSPACE_CACHE_DIRNAME);
  try {
    await fsp.mkdir(cacheDir, { recursive: true });
  } catch (err) {
    log.warn(
      "ensureClient",
      `mkdir ${cacheDir} failed: ${(err as Error).message}`,
    );
    return;
  }
  try {
    const { workingDirectory } = await c.cd({
      newWorkingDirectory: cacheDir,
    });
    log.info("ensureClient", `OMC cwd → ${workingDirectory}`);
  } catch (err) {
    log.warn(
      "ensureClient",
      `cd ${cacheDir} failed: ${(err as Error).message}`,
    );
  }
}

/**
 * Tear down the cached OMC subprocess (if any) and spawn a fresh one.
 * Used by the REPL's `:reset` meta-command — anything that survives in
 * OMC's in-memory state (loaded classes, last simulation result, command-
 * line options) is wiped.
 */
function resetClient(): Promise<OmcClient> {
  return omcClientCache.reset();
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
  libraryTree: LibraryWebviewProvider,
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return;
  const files = await discoverEntryPoints(folders.map((f) => f.uri.fsPath));
  if (files.length === 0) {
    return;
  }
  try {
    const c = await ensureClient();
    // One refresh after all loads settle — not per file, which would pile
    // concurrent OMC fetches onto the single ZeroMQ socket during startup. The
    // webview tree's own mount fetch is serialized with this one through the
    // client, so they can't overlap into a busy-socket send.
    await loadEntryFilesAndRefresh(c, files, () =>
      libraryTree.childrenChanged(null),
    );
  } catch (err) {
    log.warn("autoLoad", `OMC client unavailable: ${(err as Error).message}`);
  }
}
