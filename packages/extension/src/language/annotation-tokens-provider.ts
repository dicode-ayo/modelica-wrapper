/**
 * `vscode` wrapper for annotation semantic highlighting. Thin shell over the
 * pure {@link computeAnnotationTokens} walk (see `annotation-tokens.ts`): parse
 * the buffer, classify its annotation spans, and emit `vscode.SemanticTokens`.
 * No OMC — it shares only the parse cache.
 */

import * as vscode from "vscode";

import { log } from "../logger.js";

import {
  AnnotationTokenType,
  computeAnnotationTokens,
} from "./annotation-tokens.js";
import type { ParseCache } from "./parse.js";
import type { ZeroBasedRange } from "./position.js";

/**
 * Each annotation-token kind's standard VSCode semantic-token type. Standard
 * types are themed out of the box wherever semantic highlighting is on, so the
 * legend needs no custom `package.json` contribution.
 */
const TOKEN_TYPE: Record<AnnotationTokenType, string> = {
  [AnnotationTokenType.Record]: "type",
  [AnnotationTokenType.Field]: "property",
  [AnnotationTokenType.EnumMember]: "enumMember",
};

const LEGEND_TYPES: readonly string[] = [...new Set(Object.values(TOKEN_TYPE))];

/** The legend registered alongside the provider; also the builder's token map. */
export const ANNOTATION_SEMANTIC_TOKENS_LEGEND =
  new vscode.SemanticTokensLegend([...LEGEND_TYPES]);

/** Build a `vscode.Range` from a plain {@link ZeroBasedRange}. */
function toVscodeRange(range: ZeroBasedRange): vscode.Range {
  return new vscode.Range(
    new vscode.Position(range.start.line, range.start.character),
    new vscode.Position(range.end.line, range.end.character),
  );
}

/**
 * The `vscode.DocumentSemanticTokensProvider` registered for Modelica buffers.
 * Never throws out — a parse failure degrades to no tokens (an empty set), so
 * the TextMate grammar's baseline colouring still applies.
 */
export class AnnotationSemanticTokensProvider
  implements vscode.DocumentSemanticTokensProvider
{
  constructor(private readonly cache: ParseCache) {}

  async provideDocumentSemanticTokens(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): Promise<vscode.SemanticTokens> {
    const builder = new vscode.SemanticTokensBuilder(
      ANNOTATION_SEMANTIC_TOKENS_LEGEND,
    );
    try {
      const tree = await this.cache.parse(document);
      for (const token of computeAnnotationTokens(tree)) {
        builder.push(toVscodeRange(token.range), TOKEN_TYPE[token.type]);
      }
    } catch (err) {
      log.error("language", "semantic-tokens provider failed", err);
    }
    return builder.build();
  }
}
