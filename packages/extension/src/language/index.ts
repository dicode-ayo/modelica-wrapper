/**
 * Language-feature entry point.
 *
 * For PR 1 (foundation) this only stands up the tree-sitter parse layer and
 * keeps its cache coherent with the editor: parse on demand, drop the cached
 * tree when a Modelica document changes or closes. Later PRs add the actual
 * providers (definition / hover / completion / symbols) on top of the same
 * `ParseCache` + `ensureClient` factory, which is why both are threaded
 * through here already.
 *
 * Wired from `extension.ts` alongside the other `context.subscriptions.push`
 * registrations.
 */

import * as vscode from "vscode";

import type { OmcClient } from "@dicode/omc-client";

import { log } from "../logger.js";

import { MODELICA_LANGUAGE_ID, ParseCache } from "./parse.js";

/** Lazy OMC client accessor — same shape the commands use. */
export type EnsureClient = () => Promise<OmcClient>;

/** True for documents the language features operate on. */
function isModelicaDocument(document: vscode.TextDocument): boolean {
  return document.languageId === MODELICA_LANGUAGE_ID;
}

/**
 * Register the Modelica language features. Returns a single {@link vscode.Disposable}
 * that tears down the parse cache and all listeners — push it onto
 * `context.subscriptions`.
 *
 * @param context - the extension context; used to locate the bundled grammar
 *   WASM in `<extension>/out`.
 * @param _ensureClient - lazy OMC client; unused in PR 1, kept so later
 *   providers wire through the same factory.
 */
export function registerLanguageFeatures(
  context: vscode.ExtensionContext,
  _ensureClient: EnsureClient,
): vscode.Disposable {
  // The esbuild copy step places both `.wasm` files next to `extension.js`
  // in `out/`; resolve that directory from the extension install location.
  const wasmDir = vscode.Uri.joinPath(context.extensionUri, "out").fsPath;
  const cache = new ParseCache(wasmDir);

  const onChange = vscode.workspace.onDidChangeTextDocument((event) => {
    if (!isModelicaDocument(event.document)) return;
    if (event.contentChanges.length === 0) return;
    // Feed the deltas to the cached tree so the next parse is incremental.
    cache.applyChange(event);
  });

  const onClose = vscode.workspace.onDidCloseTextDocument((document) => {
    if (!isModelicaDocument(document)) return;
    cache.invalidate(document.uri);
  });

  log.info("language", "language features registered");

  return new vscode.Disposable(() => {
    onChange.dispose();
    onClose.dispose();
    cache.dispose();
  });
}
