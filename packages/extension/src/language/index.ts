/**
 * Language-feature wiring. Stands up the tree-sitter parse layer and keeps its
 * cache coherent with the editor (parse on demand, invalidate on change/close).
 *
 * Wired from `extension.ts` via `context.subscriptions.push`.
 */

import * as vscode from "vscode";

import type { OmcClient } from "@dicode/omc-client";

import { log } from "../logger.js";

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
} from "./resolve.js";
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
  CompletionCandidateKind,
  MAX_COMPLETIONS,
  type CompletionCandidate,
  type CompletionResult,
} from "./completion/candidate.js";
export { computeCompletions } from "./completion/compute.js";
export { type CompletionClient } from "./completion/client.js";

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
 * Register the Modelica language features. Returns a single {@link vscode.Disposable}
 * that tears down the parse cache and all listeners — push it onto
 * `context.subscriptions`.
 *
 * @param context - the extension context; used to locate the bundled grammar
 *   WASM in `<extension>/out`.
 * @param ensureClient - lazy OMC client factory; the definition/hover providers
 *   call it per request and the buffer↔OMC sync loads files through it.
 */
export function registerLanguageFeatures(
  context: vscode.ExtensionContext,
  ensureClient: EnsureClient,
): vscode.Disposable {
  // esbuild copies both `.wasm` files next to `extension.js` in `out/`.
  const wasmDir = vscode.Uri.joinPath(context.extensionUri, "out").fsPath;
  const cache = new ParseCache(wasmDir);

  // Buffer↔OMC sync (load-on-touch / re-load-on-save). The client is lazy, so
  // the SyncClient adapter resolves it per load rather than at registration.
  const syncClient: SyncClient = {
    loadFile: async (input) => (await ensureClient()).loadFile(input),
  };
  const sync = new OmcSync(syncClient);

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

  log.info("language", "language features registered");

  return new vscode.Disposable(() => {
    definitionRegistration.dispose();
    hoverRegistration.dispose();
    symbolRegistration.dispose();
    completionRegistration.dispose();
    onChange.dispose();
    onSave.dispose();
    onClose.dispose();
    cache.dispose();
  });
}
