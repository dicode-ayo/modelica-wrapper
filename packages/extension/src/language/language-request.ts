/**
 * The one procedure every Modelica language-feature provider (definition,
 * hover, completion) runs: acquire the client, derive the document's owning
 * class and load it on touch, parse the buffer, run the feature-specific
 * `compute`, and map the result to `vscode` types. Cancellation and a thrown
 * error at any step both degrade to `undefined` rather than reject. Each
 * provider contributes only its `compute` function and its `map`.
 */

import type * as vscode from "vscode";

import type { Tree } from "web-tree-sitter";

import { log } from "../logger.js";

import { resolveDocumentOwner, type DocumentSync } from "./document-scope.js";
import type { OwningClassClient } from "./owning-class.js";

/** Parse-cache surface the procedure needs; the real `ParseCache` satisfies it. */
export interface RequestParseCache {
  parse(document: vscode.TextDocument): Promise<Tree>;
}

/**
 * What a language-feature provider supplies beyond the shared procedure: its
 * OMC surface, its pure `compute`, its `vscode`-mapping, and where the two
 * cancellation checks and the failure log line differ per feature.
 */
export interface LanguageRequestDeps<
  Client extends OwningClassClient,
  Result,
  Mapped,
> {
  readonly cache: RequestParseCache;
  readonly ensureClient: () => Promise<Client>;
  readonly sync: DocumentSync;
  readonly compute: (
    tree: Tree,
    offset: number,
    owningClass: string,
    client: Client,
  ) => Promise<Result | undefined>;
  /** Map a `compute` result to the provider's `vscode` return type, or
   *  `undefined` to report no result (e.g. completion's empty candidate list). */
  readonly map: (
    result: Result,
    document: vscode.TextDocument,
  ) => Mapped | undefined;
  /**
   * Re-check cancellation after `compute` resolves. Completion's candidate
   * search spans several OMC round-trips and can outlast the keystroke that
   * asked for it.
   */
  readonly recheckTokenAfterCompute: boolean;
  /** Logged with category `"language"` when the request throws. */
  readonly failureContext: string;
}

/**
 * Run a language-feature request: resolve the document's owning class
 * (loading it on touch), parse, `compute`, `map`, and never throw out — a
 * provider must degrade to "no result" rather than surface an error to the
 * editor.
 */
export async function runLanguageRequest<
  Client extends OwningClassClient,
  Result,
  Mapped,
>(
  document: vscode.TextDocument,
  position: vscode.Position,
  token: vscode.CancellationToken,
  deps: LanguageRequestDeps<Client, Result, Mapped>,
): Promise<Mapped | undefined> {
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
    if (result === undefined) return undefined;
    return deps.map(result, document);
  } catch (err) {
    log.error("language", deps.failureContext, err);
    return undefined;
  }
}
