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

import { OmcClient, reapOrphanedOmcSessions } from "@dicode/omc-client";

import { registerCommands } from "./commands/index.js";
import { errorDetail } from "./error-detail.js";
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
import {
  createOmcClientCache,
  type OmcClientCache,
} from "./omc-client-cache.js";
import { createOmcSetup } from "./omc-setup.js";
import { createSelfWriteGuard } from "./self-write-guard.js";
import { ClassInvalidationRegistry } from "./invalidation.js";
import { publishSourceChanges } from "./source-invalidation.js";
import { LibraryWebviewProvider } from "./library/library-webview-provider.js";
import { WORKSPACE_CACHE_DIRNAME } from "./workspace-cache.js";
import { WriteVerdicts } from "./write-verdict.js";
import { multiEntityBatchToast } from "./single-entity-file.js";
import {
  registerWorkspaceAutoload,
  type WorkspaceAutoloadDeps,
} from "./workspace-autoload.js";

// Only `deactivate()` outlives `activate()`'s scope.
let closeOmcClientCache: (() => Promise<void>) | undefined;

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
  void reapStrandedOmc();

  // Every cache keyed by a Modelica class hangs off this: producers announce
  // "class X changed" once and each cache registers its own listener, so the
  // number of caches is invisible here.
  const invalidation = new ClassInvalidationRegistry();

  // Replacing the session is what re-runs the workspace sweep and rebuilds the
  // sidebar: a user who points at an `omc` after activation found none has an
  // empty tree until the load happens against the new process.
  const omcSetup = createOmcSetup({
    onOmcChanged: () => {
      void resetClient().catch((err: unknown) => {
        log.warn(
          "omc",
          `replacing the OMC session failed: ${errorDetail(err)}`,
        );
      });
    },
  });

  // `onReset` closes over the per-activation `ClassInvalidationRegistry`, so
  // this can't be built at module scope.
  const omcClientCache: OmcClientCache<OmcClient> = createOmcClientCache(
    async () => {
      const omcPath = await omcSetup.omcPath();
      const c = await OmcClient.create({ omcPath });
      await cdIntoWorkspaceCacheDir(c);
      void omcSetup.reportVersion(c, omcPath);
      return c;
    },
    (c) => c.close(),
    () => invalidation.sessionReplaced(),
  );
  closeOmcClientCache = () => omcClientCache.shutdown();
  const ensureClient = (): Promise<OmcClient> => omcClientCache.ensure();
  // Used by the REPL's `:reset` meta-command — anything that survives in
  // OMC's in-memory state (loaded classes, last simulation result,
  // command-line options) is wiped.
  const resetClient = (): Promise<OmcClient> => omcClientCache.reset();

  const libraryTree = new LibraryWebviewProvider(
    context.extensionUri,
    ensureClient,
    invalidation,
  );
  const libraryView = vscode.window.registerWebviewViewProvider(
    "modelica.libraries",
    libraryTree,
    { webviewOptions: { retainContextWhenHidden: true } },
  );

  const autoloadDeps: WorkspaceAutoloadDeps = {
    folders: () =>
      (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    ensureClient,
    refresh: () => libraryTree.childrenChanged(null),
    onSkipped: (skipped) => {
      void vscode.window.showWarningMessage(
        multiEntityBatchToast(skipped.map((s) => s.fileName)),
      );
    },
  };
  // One queue for both the activation-time sweep (`.run()` below) and every
  // `:reset` (its own `sessionReplaced` listener), so a reset landing mid-sweep
  // serializes behind it instead of racing it onto the same OMC client.
  const autoload = registerWorkspaceAutoload(invalidation, autoloadDeps);

  const selfWriteGuard = createSelfWriteGuard();
  // One instance for the whole session: the origin half of a verdict has to be
  // captured before the first mutation, and only a shared memo lets the source
  // provider's capture protect every later question about the same class.
  const writeVerdicts = new WriteVerdicts();
  const sourceProvider = new ModelicaSourceProvider(
    ensureClient,
    selfWriteGuard,
    writeVerdicts,
  );
  const docHtmlProvider = new DocumentationHtmlProvider(
    ensureClient,
    (name) => {
      // The webview's controller re-syncs even a dirty buffer through its queue;
      // notifySourceChanged also reloads a plain `.mo` text editor if one is open.
      notifyDocumentationChanged(name);
      sourceProvider.notifySourceChanged(name);
    },
    writeVerdicts,
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

  // The source provider's change broadcast is the broad producer feeding the
  // registry: every write that lands in OMC — a text-editor save, a mutation
  // command, the `.mo` watcher reloading a foreign edit — ends there. An
  // unsaved graphical commit reaches OMC but not that broadcast, so the
  // diagram/icon editors announce their own class (their callback below).
  context.subscriptions.push(
    publishSourceChanges(sourceProvider, invalidation),
  );

  // Keep OMC and the sidebar reactive to bare `.mo` edits (text-editor saves,
  // Explorer/external create/delete) that never pass through a mutation command.
  context.subscriptions.push(
    registerMoFileWatcher({
      ensureClient,
      libraryTree,
      sourceProvider,
      guard: selfWriteGuard,
      invalidation,
    }),
  );

  context.subscriptions.push(
    omcSetup,
    libraryTree,
    libraryView,
    autoload,
    diagnostics,
    ResultViewEditorProvider.register(context, ensureClient),
    DiagramEditorProvider.register(
      context,
      ensureClient,
      writeVerdicts,
      DIAGRAM_VIEW_TYPE,
      "diagram",
      (className) => invalidation.classChanged(className),
    ),
    DiagramEditorProvider.register(
      context,
      ensureClient,
      writeVerdicts,
      ICON_VIEW_TYPE,
      "icon",
      (className) => invalidation.classChanged(className),
    ),
    DocumentationEditorProvider.register(
      context,
      ensureClient,
      writeVerdicts,
      DOCUMENTATION_VIEW_TYPE,
    ),
    registerLanguageFeatures(context, ensureClient, invalidation),
    wireDocHtmlRefresh(docHtmlProvider),
    ...registerCommands({
      extensionContext: context,
      ensureClient,
      resetClient,
      libraryTree,
      sourceProvider,
      diagnostics,
      selfWriteGuard,
      writeVerdicts,
    }),
  );

  // Re-open editors VSCode restored before the scheme went live; see the note
  // on `recoverRestoredCustomEditors`.
  void recoverRestoredCustomEditors();

  // Neither blocks: OMC startup is slow, and the missing-OpenModelica
  // notification waits on the user.
  void omcSetup.start();
  autoload.run();

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
  await closeOmcClientCache?.();
  log.dispose();
}

/**
 * Shut down OMC processes left behind by an extension host that died before
 * `deactivate()`. Runs alongside activation; it only ever touches sessions
 * whose owning process is gone, so it cannot disturb this window's client.
 */
async function reapStrandedOmc(): Promise<void> {
  try {
    const count = await reapOrphanedOmcSessions();
    if (count > 0) {
      log.info("activate", `reaped ${count} stranded OMC session(s)`);
    }
  } catch (err) {
    log.warn("activate", `reaping stranded OMC failed: ${String(err)}`);
  }
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
