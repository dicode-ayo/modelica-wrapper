/**
 * Language-feature wiring. Stands up the tree-sitter parse layer and keeps its
 * cache coherent with the editor (parse on demand, invalidate on change/close).
 *
 * Wired from `extension.ts` via `context.subscriptions.push`.
 */

import * as vscode from "vscode";

import type { OmcClient } from "@dicode/omc-client";

import { log } from "../logger.js";

import { ModelicaDefinitionProvider } from "./definition-provider.js";
import { ModelicaHoverProvider } from "./hover-provider.js";
import {
  MODELICA_DOCUMENT_SELECTOR,
  MODELICA_LANGUAGE_ID,
  ParseCache,
} from "./parse.js";
import { OmcSync, type SyncClient } from "./sync.js";

// Single `./language` entry point: re-export the resolution layer alongside
// the def/hover providers so consumers don't reach into individual modules.
// Client-shape interfaces and the filesystem probe stay module-internal —
// they're test seams, not API.
export { resolve, type ResolvedTarget } from "./resolve.js";
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
} from "./hover-provider.js";

/** Lazy OMC client accessor — same shape the commands use. */
export type EnsureClient = () => Promise<OmcClient>;

function isModelicaDocument(document: vscode.TextDocument): boolean {
  return document.languageId === MODELICA_LANGUAGE_ID;
}

/**
 * Register the language features. Returns a single {@link vscode.Disposable}
 * that tears down the parse cache and listeners.
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

  const definitionProvider = new ModelicaDefinitionProvider(
    cache,
    ensureClient,
    sync,
  );
  const hoverProvider = new ModelicaHoverProvider(cache, ensureClient, sync);

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

  const onChange = vscode.workspace.onDidChangeTextDocument((event) => {
    if (!isModelicaDocument(event.document)) return;
    if (event.contentChanges.length === 0) return;
    cache.applyChange(event);
  });

  // Re-load on save so resolution reflects the now-current on-disk text.
  const onSave = vscode.workspace.onDidSaveTextDocument((document) => {
    if (!isModelicaDocument(document)) return;
    sync.invalidate(document.uri.fsPath);
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
    onChange.dispose();
    onSave.dispose();
    onClose.dispose();
    cache.dispose();
  });
}
