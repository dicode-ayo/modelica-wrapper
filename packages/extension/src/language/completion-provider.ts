/**
 * The host wrapper for Modelica autocomplete: the `vscode.CompletionItemProvider`
 * registered for Modelica buffers, plus the mapping from the core's plain-data
 * candidate kind to `vscode.CompletionItemKind`. The routing + OMC queries live
 * in {@link computeCompletions} (`@dicode/modelica-completion`), a pure function
 * with no `vscode` import.
 */

import * as vscode from "vscode";

import {
  CompletionCandidateKind,
  computeCompletions,
  type CompletionClient,
} from "@dicode/modelica-completion";

import { log } from "../logger.js";

import { runLanguageRequest } from "./language-request.js";
import type { OwningClassClient } from "./owning-class.js";
import type { ParseCache } from "./parse.js";
import type { OmcSync } from "./sync.js";

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
    return runLanguageRequest(document, position, token, {
      cache: this.cache,
      ensureClient: this.ensureClient,
      sync: this.sync,
      compute: (tree, offset, owningClass, client) =>
        computeCompletions(tree, offset, owningClass, client, { logger: log }),
      map: (computed) => {
        if (computed.candidates.length === 0) return undefined;
        const items = computed.candidates.map((c) => {
          const item = new vscode.CompletionItem(
            c.label,
            toVscodeCompletionKind(c.kind),
          );
          if (c.detail !== undefined) item.detail = c.detail;
          // Dotted class names need an explicit filter/insert so VSCode's
          // word-based filtering matches the bare typed prefix and accepting
          // the item inserts the simple name rather than the FQN.
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
        // fuzzy global net depends on it); false lets it filter this set
        // locally.
        return new vscode.CompletionList(items, computed.isIncomplete);
      },
      recheckTokenAfterCompute: true,
      failureContext: "completion provider failed",
    });
  }
}
