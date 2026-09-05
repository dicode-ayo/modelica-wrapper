/**
 * The one procedure every Modelica language-feature provider (definition,
 * hover, completion) runs: acquire the client, derive the document's owning
 * class and load it on touch, parse the buffer, run the feature-specific
 * `compute`, and degrade to `undefined` on cancellation or a thrown error.
 * Each provider contributes only its `compute` function and the mapping from
 * the result to `vscode` types.
 */

import * as vscode from "vscode";

import type { Tree } from "web-tree-sitter";

import { log } from "../logger.js";

import { resolveDocumentOwner } from "./document-scope.js";
import type { OwningClassClient } from "./owning-class.js";
import type { ParseCache } from "./parse.js";
import type { OmcSync } from "./sync.js";

/**
 * What a language-feature provider supplies beyond the shared procedure:
 * its OMC surface, its pure `compute`, and where the two cancellation checks
 * and the failure log line differ per feature.
 */
export interface LanguageRequestDeps<Client extends OwningClassClient, Result> {
  readonly cache: ParseCache;
  readonly ensureClient: () => Promise<Client>;
  readonly sync: OmcSync;
  readonly compute: (
    tree: Tree,
    offset: number,
    owningClass: string,
    client: Client,
  ) => Promise<Result | undefined>;
  /**
   * Re-check cancellation after `compute` resolves, before returning its
   * result. Completion needs this (a multi-round-trip candidate search can
   * outlast the keystroke that asked for it); definition and hover don't
   * re-check here today — a deliberate per-feature choice, not an oversight.
   */
  readonly recheckTokenAfterCompute: boolean;
  /** Logged with category `"language"` when the request throws. */
  readonly failureContext: string;
}

/**
 * Run a language-feature request: resolve the document's owning class
 * (loading it on touch), parse, `compute`, and never throw out — a provider
 * must degrade to "no result" rather than surface an error to the editor.
 */
export async function runLanguageRequest<
  Client extends OwningClassClient,
  Result,
>(
  document: vscode.TextDocument,
  position: vscode.Position,
  token: vscode.CancellationToken,
  deps: LanguageRequestDeps<Client, Result>,
): Promise<Result | undefined> {
  try {
    const client = await deps.ensureClient();
    // Derive the owning class and load-on-touch (real files only; a virtual
    // `modelica-source:` class is already loaded — see `document-scope.ts`).
    const owning = await resolveDocumentOwner(document, client, deps.sync);
    if (!owning) return undefined;

    // Bail between the load and resolve round-trips so a cursor that has
    // already moved on doesn't issue further OMC calls.
    if (token.isCancellationRequested) return undefined;

    const tree = await deps.cache.parse(document);
    const result = await deps.compute(
      tree,
      document.offsetAt(position),
      owning.qualifiedName,
      client,
    );
    if (deps.recheckTokenAfterCompute && token.isCancellationRequested) {
      return undefined;
    }
    return result;
  } catch (err) {
    log.error("language", deps.failureContext, err);
    return undefined;
  }
}
