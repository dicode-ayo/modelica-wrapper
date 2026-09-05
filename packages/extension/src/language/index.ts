/**
 * Language-feature wiring. Stands up the tree-sitter parse layer and keeps its
 * cache coherent with the editor (parse on demand, invalidate on change/close).
 *
 * Wired from `extension.ts` via `context.subscriptions.push`.
 */

import * as vscode from "vscode";

import type { OmcClient } from "@dicode/omc-client";

import type { ClassInvalidationRegistry } from "../invalidation.js";
import { log } from "../logger.js";
import { multiEntityMessage, multiEntityToast } from "../single-entity-file.js";
import { sourceUriFor } from "../source-provider.js";

import {
  ANNOTATION_SEMANTIC_TOKENS_LEGEND,
  AnnotationSemanticTokensProvider,
} from "./annotation-tokens-provider.js";
import {
  COMPLETION_TRIGGER_CHARACTER,
  ModelicaCompletionProvider,
} from "./completion-provider.js";
import { ModelicaDefinitionProvider } from "./definition-provider.js";
import { ModelicaHoverProvider } from "./hover-provider.js";
import { OmcLookupCache, type CachedOmcClient } from "./omc-cache.js";
import {
  MODELICA_DOCUMENT_SELECTOR,
  MODELICA_LANGUAGE_ID,
  ParseCache,
} from "./parse.js";
import { ModelicaDocumentSymbolProvider } from "./symbols-provider.js";
import { OmcSync, type SyncClient } from "./sync.js";

// Single `./language` entry point: re-export the resolution layer alongside
// the def/hover providers so consumers don't reach into individual modules.
// Client-shape interfaces and the filesystem probe stay module-internal —
// they're test seams, not API.
export {
  resolve,
  qualifyTypeReference,
  walkCrefType,
  type ResolvedTarget,
} from "@dicode/modelica-lang-core";
export { resolveOwningClass, type OwningClass } from "./owning-class.js";
export { OmcSync } from "./sync.js";
export {
  omcToVscodePosition,
  omcRangeToVscodeRange,
  type ZeroBasedPosition,
  type ZeroBasedRange,
} from "./position.js";
export {
  ModelicaDefinitionProvider,
  computeDefinition,
  type DefinitionSite,
} from "./definition-provider.js";
export {
  ModelicaHoverProvider,
  computeHover,
  renderHover,
  type HoverClient,
  type HoverResult,
} from "./hover-provider.js";
export {
  ModelicaDocumentSymbolProvider,
  computeDocumentSymbols,
  classKind,
  toVscodeSymbolKind,
  SymbolKind,
  type SymbolNode,
} from "./symbols-provider.js";
export {
  ModelicaCompletionProvider,
  toVscodeCompletionKind,
  COMPLETION_TRIGGER_CHARACTER,
} from "./completion-provider.js";
export {
  computeCompletions,
  CompletionCandidateKind,
  MAX_COMPLETIONS,
  type CompletionCandidate,
  type CompletionResult,
  type CompletionClient,
} from "@dicode/modelica-completion";
export {
  AnnotationSemanticTokensProvider,
  ANNOTATION_SEMANTIC_TOKENS_LEGEND,
} from "./annotation-tokens-provider.js";
export {
  computeAnnotationTokens,
  AnnotationTokenType,
  type AnnotationToken,
} from "./annotation-tokens.js";

/** Lazy OMC client accessor — same shape the commands use. */
export type EnsureClient = () => Promise<OmcClient>;

function isModelicaDocument(document: vscode.TextDocument): boolean {
  return document.languageId === MODELICA_LANGUAGE_ID;
}

/**
 * The save-event glue, extracted so it is unit-testable without an extension
 * host (see `index.test.ts`). On a Modelica document save it (1) invalidates
 * the file's loaded state via `sync` so the next touch re-`loadFile`s and
 * (2) drops the OMC-lookup cache — the saved text is about to be reloaded,
 * so cached qualify/components/class-name answers may no longer hold. A
 * non-Modelica save is a no-op. The cache is looked up lazily (it is created
 * on first provider use) so this is robust to the save firing before any
 * provider request.
 *
 * @returns `true` if the save was handled (a Modelica doc), `false` if ignored.
 */
export function handleDocumentSave(
  document: vscode.TextDocument,
  sync: Pick<OmcSync, "invalidate">,
  getLookupCache: () => Pick<OmcLookupCache, "invalidate"> | undefined,
): boolean {
  if (!isModelicaDocument(document)) return false;
  sync.invalidate(document.uri.fsPath);
  getLookupCache()?.invalidate();
  return true;
}

/**
 * Drop what the language layer caches for a class whose definition changed
 * outside the editor — the `.mo` watcher reloading a foreign edit or a git
 * checkout, a mutation command, a graphical commit.
 *
 * The signal names a class, not a buffer, so the parse tree is dropped for
 * that class's `modelica-source:` document; the lookup cache is keyed by the
 * loaded-library signature, which an in-place reload of an already-loaded file
 * leaves unmoved, so it is cleared wholesale.
 *
 * `OmcSync` is left alone. Every producer announces a class only once the
 * change is already in OMC, so its "this path is loaded" flag stays true, and
 * clearing it would schedule a `loadFile` that re-reads disk over an OMC-only
 * edit — which is what an unsaved graphical commit is.
 */
export function handleClassChanged(
  className: string,
  parseCache: Pick<ParseCache, "invalidate">,
  getLookupCache: () => Pick<OmcLookupCache, "invalidate"> | undefined,
): void {
  parseCache.invalidate(sourceUriFor(className));
  getLookupCache()?.invalidate();
}

/**
 * Register the Modelica language features. Returns a single {@link vscode.Disposable}
 * that tears down the parse cache and all listeners — push it onto
 * `context.subscriptions`.
 *
 * @param context - the extension context; used to locate the bundled grammar
 *   WASM in `<extension>/out`.
 * @param ensureClient - lazy OMC client factory; the definition/hover providers
 *   call it per request and the buffer↔OMC sync loads files through it.
 * @param invalidation - the class-invalidation registry; the parse and lookup
 *   caches subscribe to it for changes that never pass through a text-document
 *   event.
 */
export function registerLanguageFeatures(
  context: vscode.ExtensionContext,
  ensureClient: EnsureClient,
  invalidation: ClassInvalidationRegistry,
): vscode.Disposable {
  // esbuild copies both `.wasm` files next to `extension.js` in `out/`.
  const wasmDir = vscode.Uri.joinPath(context.extensionUri, "out").fsPath;
  const cache = new ParseCache(wasmDir);

  // Buffer↔OMC sync (load-on-touch / re-load-on-save). The client is lazy, so
  // the SyncClient adapter resolves it per load rather than at registration.
  const syncClient: SyncClient = {
    loadFile: async (input) => (await ensureClient()).loadFile(input),
    parseFile: async (input) => (await ensureClient()).parseFile(input),
  };
  const sync = new OmcSync(syncClient, {
    onMultiEntity: (filePath, classNames) => {
      log.warn("language", multiEntityMessage(filePath, classNames));
      void vscode.window.showWarningMessage(
        multiEntityToast(
          filePath,
          classNames,
          "language features are unavailable for it",
        ),
      );
    },
  });

  // One shared read-only-lookup cache for resolution + completion, keyed by the
  // loaded-library signature (see `omc-cache.ts`). It is created on first use
  // (the OMC client is lazy) and re-pointed if the underlying client is replaced
  // (REPL `:reset`). The definition/hover/completion providers consume it via
  // `cachedEnsureClient` so a single instance is shared (and save-invalidated).
  let lookupCache: OmcLookupCache | undefined;
  const cachedEnsureClient = async (): Promise<OmcLookupCache> => {
    // `OmcClient` structurally satisfies `CachedOmcClient` (the intersection of
    // `CompletionClient & HoverClient & LoadedLibrariesClient & ParseFileClient`),
    // so the lazy factory's return type assigns through without a cast.
    const client: CachedOmcClient = await ensureClient();
    if (!lookupCache) {
      lookupCache = new OmcLookupCache(client);
    } else {
      lookupCache.rewrap(client);
    }
    return lookupCache;
  };

  const definitionProvider = new ModelicaDefinitionProvider(
    cache,
    cachedEnsureClient,
    sync,
  );
  const hoverProvider = new ModelicaHoverProvider(
    cache,
    cachedEnsureClient,
    sync,
  );
  // Document symbols / outline is OMC-free — it walks the parsed tree alone,
  // so it shares only the parse cache.
  const symbolProvider = new ModelicaDocumentSymbolProvider(cache);
  // Annotation semantic highlighting is likewise OMC-free — tree only.
  const semanticTokensProvider = new AnnotationSemanticTokensProvider(cache);
  const completionProvider = new ModelicaCompletionProvider(
    cache,
    cachedEnsureClient,
    sync,
  );

  // Bind both providers to Modelica buffers. The repo's shared selector matches
  // by language id only (no scheme) so it covers real files AND the in-memory
  // `modelica-source:` scheme the diagram editor uses.
  const definitionRegistration = vscode.languages.registerDefinitionProvider(
    MODELICA_DOCUMENT_SELECTOR,
    definitionProvider,
  );
  const hoverRegistration = vscode.languages.registerHoverProvider(
    MODELICA_DOCUMENT_SELECTOR,
    hoverProvider,
  );
  const symbolRegistration = vscode.languages.registerDocumentSymbolProvider(
    MODELICA_DOCUMENT_SELECTOR,
    symbolProvider,
  );
  const semanticTokensRegistration =
    vscode.languages.registerDocumentSemanticTokensProvider(
      MODELICA_DOCUMENT_SELECTOR,
      semanticTokensProvider,
      ANNOTATION_SEMANTIC_TOKENS_LEGEND,
    );
  // `.` triggers member-access completion; for the other contexts VSCode invokes
  // the provider on the normal identifier-typing path.
  const completionRegistration =
    vscode.languages.registerCompletionItemProvider(
      MODELICA_DOCUMENT_SELECTOR,
      completionProvider,
      COMPLETION_TRIGGER_CHARACTER,
    );

  const onChange = vscode.workspace.onDidChangeTextDocument((event) => {
    if (!isModelicaDocument(event.document)) return;
    if (event.contentChanges.length === 0) return;
    cache.applyChange(event);
  });

  // Re-load on save so resolution reflects the now-current on-disk text, and
  // drop the OMC-lookup cache: the saved file is about to be re-`loadFile`d, so
  // any cached qualify/components/class-name answers may no longer hold.
  const onSave = vscode.workspace.onDidSaveTextDocument((document) => {
    handleDocumentSave(document, sync, () => lookupCache);
  });

  const onClose = vscode.workspace.onDidCloseTextDocument((document) => {
    if (!isModelicaDocument(document)) return;
    cache.invalidate(document.uri);
    sync.invalidate(document.uri.fsPath);
  });

  const onClassChanged = invalidation.register((className) => {
    handleClassChanged(className, cache, () => lookupCache);
  });

  // A mutation with no class name to it leaves nothing to invalidate
  // selectively: every parse tree and every cached lookup could be derived
  // from whatever moved.
  const onAllClassesChanged = invalidation.registerAllClassesChanged(() => {
    cache.invalidateAll();
    lookupCache?.invalidate();
  });

  // `:reset` wipes OMC's AST without touching a single class, so the
  // per-class signal above never fires for it — `sync`'s "loaded" flags would
  // otherwise keep claiming files are in a symbol table that no longer
  // exists. The lookup cache needs no wiring here: it re-points itself via
  // `rewrap` the next time `cachedEnsureClient` sees a new client identity.
  const onSessionReplaced = invalidation.registerSessionReplaced(() => {
    sync.resetSession();
  });

  log.info("language", "language features registered");

  return new vscode.Disposable(() => {
    definitionRegistration.dispose();
    hoverRegistration.dispose();
    symbolRegistration.dispose();
    semanticTokensRegistration.dispose();
    completionRegistration.dispose();
    onChange.dispose();
    onSave.dispose();
    onClose.dispose();
    onClassChanged.dispose();
    onAllClassesChanged.dispose();
    onSessionReplaced.dispose();
    cache.dispose();
  });
}
