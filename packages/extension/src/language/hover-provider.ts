/**
 * Hover for Modelica buffers. Same resolution path as go-to-definition (parse →
 * classify cursor → resolve the name to its fully-qualified entity), rendered as
 * the entity's restriction (model / block / package / …) and documentation
 * comment in a `vscode.MarkdownString`.
 *
 * {@link computeHover} holds the resolution + markdown assembly as a string with
 * no `vscode` import (unit-tested against a mocked client);
 * {@link ModelicaHoverProvider} is the host wrapper.
 */

import * as vscode from "vscode";

import type { Tree } from "web-tree-sitter";

import {
  resolve,
  targetAt,
  type ResolveClient,
} from "@dicode/modelica-lang-core";

import { log } from "../logger.js";

import { runLanguageRequest } from "./language-request.js";
import type { OwningClassClient } from "./owning-class.js";
import type { ParseCache } from "./parse.js";
import type { OmcSync } from "./sync.js";

/**
 * OMC surface the hover renderer needs: the resolution calls (via
 * {@link ResolveClient}) plus the two typed metadata wrappers used to render the
 * tooltip. `OmcClient` satisfies this, so real call sites pass it unchanged.
 */
export interface HoverClient extends ResolveClient {
  getClassInformation(input: { typeName: string }): Promise<{
    fileName: string;
    restriction: string;
    comment: string;
  }>;
  getClassComment(input: { typeName: string }): Promise<{ comment: string }>;
}

/** A rendered hover: the markdown plus the source span it describes. */
export interface HoverResult {
  readonly markdown: string;
  /** UTF-16 offsets of the identifier under the cursor, for the underline. */
  readonly startIndex: number;
  readonly endIndex: number;
}

/**
 * Render the hover for the cursor at `offset` in `tree`, scoped to `owningClass`,
 * or `undefined` when nothing resolves. No `vscode` import — unit-tested directly
 * against a mocked {@link HoverClient}.
 *
 * The tooltip is the resolved entity's restriction keyword + its fully-qualified
 * name (as a fenced `modelica` declaration line) followed by the documentation
 * comment, if any. The description-string comment is read via the dedicated
 * `getClassComment` wrapper; `getClassInformation` supplies the restriction. The
 * returned span is the cursor target, so the wrapper underlines it without
 * re-walking the tree.
 *
 * @param tree - parsed buffer (from `ParseCache.parse`).
 * @param offset - UTF-16 code-unit offset (i.e. `document.offsetAt(position)`).
 * @param owningClass - fully-qualified name of the class the document defines.
 * @param client - structural OMC surface; a real `OmcClient` satisfies it.
 */
export async function computeHover(
  tree: Tree,
  offset: number,
  owningClass: string,
  client: HoverClient,
): Promise<HoverResult | undefined> {
  const target = targetAt(tree, offset);
  if (!target) return undefined;

  const resolved = await resolve(owningClass, target, client, log);
  if (!resolved) return undefined;

  const { qualifiedName } = resolved;
  try {
    const info = await client.getClassInformation({ typeName: qualifiedName });
    // `getClassComment` is the full description string; `getClassInformation`'s
    // comment is the fallback when it returns nothing.
    const { comment: classComment } = await client.getClassComment({
      typeName: qualifiedName,
    });
    const comment = classComment.length > 0 ? classComment : info.comment;
    const markdown = renderHover(qualifiedName, info.restriction, comment);
    return {
      markdown,
      startIndex: target.startIndex,
      endIndex: target.endIndex,
    };
  } catch (err) {
    // Resolution succeeded but the metadata round-trip failed — no hover rather
    // than a partial/incorrect one.
    log.error("language", "hover metadata lookup failed", err);
    return undefined;
  }
}

/**
 * Escape the markdown metacharacters in a free-form string so it renders as
 * literal text. The Modelica doc `comment` is the quoted description after a
 * class name — user-controlled prose that can contain markdown specials
 * (`*`, `_`, backticks, `[..](..)`, `#`, …) or raw HTML. Appended raw it would
 * be *re-interpreted* (underscores italicise, a stray backtick swallows the
 * rest of the line, `<...>` is dropped as HTML). Escaping the CommonMark ASCII
 * punctuation set keeps the comment faithful; `<`/`>` are encoded so HTML-ish
 * fragments survive verbatim.
 */
export function escapeMarkdown(text: string): string {
  // Encode the three HTML-ish characters that the markdown renderer would
  // otherwise interpret (`&` first so the subsequent escapes don't get
  // double-encoded), then backslash-escape CommonMark ASCII punctuation.
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}[\]()#+\-.!|~]/g, "\\$&");
}

/**
 * Assemble the hover markdown from an entity's restriction, qualified name, and
 * documentation comment. Pure string formatting — kept separate so the shape is
 * testable. The signature line is fenced as `modelica` so the editor
 * syntax-highlights it; the comment follows as plain text (markdown-escaped, so
 * specials in a Modelica description aren't re-interpreted).
 */
export function renderHover(
  qualifiedName: string,
  restriction: string,
  comment: string,
): string {
  const restrictionPrefix = restriction.length > 0 ? `${restriction} ` : "";
  const signature = `${restrictionPrefix}${qualifiedName}`;
  const lines = ["```modelica", signature, "```"];
  if (comment.length > 0) {
    lines.push("", escapeMarkdown(comment));
  }
  return lines.join("\n");
}

/**
 * The `vscode.HoverProvider` registered for Modelica buffers. Thin wrapper over
 * {@link computeHover}: parse, derive the owning class, ensure OMC has the file
 * loaded, render the markdown, then wrap it in a `vscode.Hover`.
 */
export class ModelicaHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly cache: ParseCache,
    private readonly ensureClient: () => Promise<
      HoverClient & OwningClassClient
    >,
    private readonly sync: OmcSync,
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    return runLanguageRequest(document, position, token, {
      cache: this.cache,
      ensureClient: this.ensureClient,
      sync: this.sync,
      compute: computeHover,
      // Underline the identifier under the cursor so the hover anchors to it
      // rather than the whole token run.
      map: (result, doc) =>
        new vscode.Hover(
          new vscode.MarkdownString(result.markdown),
          new vscode.Range(
            doc.positionAt(result.startIndex),
            doc.positionAt(result.endIndex),
          ),
        ),
      recheckTokenAfterCompute: false,
      failureContext: "hover provider failed",
    });
  }
}
