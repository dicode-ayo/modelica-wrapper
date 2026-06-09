/**
 * The host wrapper for Modelica autocomplete: the `vscode.CompletionItemProvider`
 * registered for Modelica buffers, plus the mapping from the core's plain-data
 * candidate kind to `vscode.CompletionItemKind`. The routing + OMC queries live
 * in {@link computeCompletions} (`./completion/compute.ts`), a pure function with
 * no `vscode` import.
 */

import * as vscode from "vscode";

import { log } from "../logger.js";

import { CompletionCandidateKind } from "./completion/candidate.js";
import type { CompletionClient } from "./completion/client.js";
import { computeCompletions } from "./completion/compute.js";
import { resolveDocumentOwner } from "./document-scope.js";
import type { OwningClassClient } from "./owning-class.js";
import type { ParseCache } from "./parse.js";
import { OmcSync } from "./sync.js";

/** The trigger character that fires member-access completion. */
export const COMPLETION_TRIGGER_CHARACTER = ".";

/** Map the local kind enum to VSCode's. Lives in the thin (impure) layer. */
export function toVscodeCompletionKind(
  kind: CompletionCandidateKind,
): vscode.CompletionItemKind {
  switch (kind) {
    case CompletionCandidateKind.Class:
      return vscode.CompletionItemKind.Class;
    case CompletionCandidateKind.Field:
      return vscode.CompletionItemKind.Field;
    case CompletionCandidateKind.Property:
      return vscode.CompletionItemKind.Property;
    case CompletionCandidateKind.Keyword:
      return vscode.CompletionItemKind.Keyword;
    case CompletionCandidateKind.Snippet:
      return vscode.CompletionItemKind.Snippet;
  }
}

/**
 * The `vscode.CompletionItemProvider` registered for Modelica buffers. Thin
 * wrapper over {@link computeCompletions}: parse, derive the owning class,
 * ensure OMC has the file loaded, compute candidates, then map them to
 * `vscode.CompletionItem`s. Never throws out — degrades to no completions — and
 * honours the cancellation token.
 */
export class ModelicaCompletionProvider
  implements vscode.CompletionItemProvider
{
  constructor(
    private readonly cache: ParseCache,
    private readonly ensureClient: () => Promise<
      CompletionClient & OwningClassClient
    >,
    private readonly sync: OmcSync,
  ) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.CompletionList | undefined> {
    try {
      const client = await this.ensureClient();
      // Real files load on touch; a virtual `modelica-source:` class is already
      // loaded (see `document-scope.ts`).
      const owning = await resolveDocumentOwner(document, client, this.sync);
      if (!owning) return undefined;

      // Bail between the load and resolve round-trips so a cursor that has
      // already moved on doesn't issue further OMC calls.
      if (token.isCancellationRequested) return undefined;

      const tree = await this.cache.parse(document);
      const { candidates, isIncomplete } = await computeCompletions(
        tree,
        document.offsetAt(position),
        owning.qualifiedName,
        client,
      );
      if (token.isCancellationRequested) return undefined;
      if (candidates.length === 0) return undefined;

      const items = candidates.map((c) => {
        const item = new vscode.CompletionItem(
          c.label,
          toVscodeCompletionKind(c.kind),
        );
        if (c.detail !== undefined) item.detail = c.detail;
        // Dotted class names need an explicit filter/insert so VSCode's
        // word-based filtering matches the bare typed prefix and accepting the
        // item inserts the simple name rather than the FQN.
        if (c.filterText !== undefined) item.filterText = c.filterText;
        if (c.insertText !== undefined) {
          // A snippet's insertText carries placeholder syntax; wrap it so
          // VSCode expands the template instead of inserting it verbatim.
          item.insertText = c.isSnippet
            ? new vscode.SnippetString(c.insertText)
            : c.insertText;
        }
        return item;
      });

      // `isIncomplete` true makes VSCode re-invoke as the prefix grows (the
      // fuzzy global net depends on it); false lets it filter this set locally.
      return new vscode.CompletionList(items, isIncomplete);
    } catch (err) {
      // A provider must never throw out — degrade to "no completions".
      log.error("language", "completion provider failed", err);
      return undefined;
    }
  }
}
