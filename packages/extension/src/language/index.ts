/**
 * Language-feature wiring. Stands up the tree-sitter parse layer and keeps its
 * cache coherent with the editor (parse on demand, invalidate on change/close).
 *
 * Wired from `extension.ts` via `context.subscriptions.push`.
 */

import * as vscode from "vscode";

import type { OmcClient } from "@dicode/omc-client";

import { log } from "../logger.js";

import { MODELICA_LANGUAGE_ID, ParseCache } from "./parse.js";

/** Lazy OMC client accessor — same shape the commands use. */
export type EnsureClient = () => Promise<OmcClient>;

function isModelicaDocument(document: vscode.TextDocument): boolean {
  return document.languageId === MODELICA_LANGUAGE_ID;
}

/**
 * Register the language features. Returns a single {@link vscode.Disposable}
 * that tears down the parse cache and listeners.
 *
 * @param context - extension context; used to locate the bundled grammar WASM.
 * @param _ensureClient - lazy OMC client (threaded through for providers).
 */
export function registerLanguageFeatures(
  context: vscode.ExtensionContext,
  _ensureClient: EnsureClient,
): vscode.Disposable {
  // esbuild copies both `.wasm` files next to `extension.js` in `out/`.
  const wasmDir = vscode.Uri.joinPath(context.extensionUri, "out").fsPath;
  const cache = new ParseCache(wasmDir);

  const onChange = vscode.workspace.onDidChangeTextDocument((event) => {
    if (!isModelicaDocument(event.document)) return;
    if (event.contentChanges.length === 0) return;
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
