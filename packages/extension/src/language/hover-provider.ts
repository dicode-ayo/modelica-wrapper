/**
 * Hover provider — the explanatory half of the hybrid loop (#97).
 *
 * Same resolution path as go-to-definition (parse → classify cursor → resolve
 * the name to its fully-qualified entity), but instead of a `Location` it
 * renders the entity's **restriction** (model / block / package / function / …)
 * and its **documentation comment** as a `vscode.MarkdownString`.
 *
 * ## Pure / impure split (testability)
 *
 * Mirrors `definition-provider.ts`: the resolution + markdown assembly lives in
 * {@link computeHover}, which takes a tree-sitter `Tree` + offset + owning class
 * + a structural OMC surface and returns a **markdown string** (or `undefined`)
 * with NO `vscode` import, so it is unit-testable against a mocked client. The
 * `vscode.HoverProvider` wrapper ({@link ModelicaHoverProvider}) is a thin shell
 * that parses, derives the owning class, ensures the file is loaded, calls
 * `computeHover`, and wraps the result in a `vscode.Hover`.
 *
 * Restriction + comment come from the typed `getClassInformation` /
 * `getClassComment` wrappers — never raw `client.call`. A resolution failure or
 * OMC error yields `undefined` (no hover), never a thrown error out of the
 * provider.
 */

import * as vscode from "vscode";

import type { OmcClient } from "@dicode/omc-client";
import type { Tree } from "web-tree-sitter";

import { log } from "../logger.js";

import { targetAt } from "./cursor.js";
import type { ParseCache } from "./parse.js";
import { resolveOwningClass, type OwningClassClient } from "./owning-class.js";
import { resolve, type ResolveClient } from "./resolve.js";
import { OmcSync } from "./sync.js";

/**
 * OMC surface the hover renderer needs: the resolution calls (via
 * {@link ResolveClient}) plus the two typed metadata wrappers used to render the
 * tooltip. `OmcClient` satisfies this, so real call sites pass it unchanged.
 */
export interface HoverClient extends ResolveClient {
  getClassInformation(input: { typeName: string }): Promise<{
    fileName: string;
    lineNumberStart: number;
    columnNumberStart: number;
    restriction: string;
    comment: string;
  }>;
  getClassComment(input: { typeName: string }): Promise<{ comment: string }>;
}

/**
 * Render the hover markdown for the cursor at `offset` in `tree`, scoped to
 * `owningClass`, or `undefined` when nothing resolves. No `vscode` import —
 * unit-tested directly against a mocked {@link HoverClient}.
 *
 * The tooltip is the resolved entity's restriction keyword + its fully-qualified
 * name (as a fenced `modelica` declaration line) followed by the documentation
 * comment, if any. The description-string comment is read via the dedicated
 * `getClassComment` wrapper; `getClassInformation` supplies the restriction.
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
): Promise<string | undefined> {
  const target = targetAt(tree, offset);
  if (!target) return undefined;

  const resolved = await resolve(owningClass, target, client);
  if (!resolved) return undefined;

  const { qualifiedName } = resolved;
  let restriction = "";
  let comment = "";
  try {
    const info = await client.getClassInformation({ typeName: qualifiedName });
    restriction = info.restriction;
    // `getClassInformation` also carries a comment, but the design pins the
    // dedicated `getClassComment` wrapper as the doc-comment source; prefer it
    // and fall back to the bundled comment if the dedicated call yields nothing.
    const { comment: classComment } = await client.getClassComment({
      typeName: qualifiedName,
    });
    comment = classComment.length > 0 ? classComment : info.comment;
  } catch (err) {
    // Resolution succeeded but the metadata round-trip failed — no hover rather
    // than a partial/incorrect one.
    log.error("language", "hover metadata lookup failed", err);
    return undefined;
  }

  return renderHover(qualifiedName, restriction, comment);
}

/**
 * Assemble the hover markdown from an entity's restriction, qualified name, and
 * documentation comment. Pure string formatting — kept separate so the shape is
 * testable. The signature line is fenced as `modelica` so the editor
 * syntax-highlights it; the comment follows as plain markdown.
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
    lines.push("", comment);
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
    private readonly ensureClient: () => Promise<OmcClient>,
    private readonly sync: OmcSync,
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    try {
      const client = await this.ensureClient();
      const owning = await resolveOwningClass(document.uri.fsPath, {
        client: client as OwningClassClient,
      });
      if (!owning) return undefined;

      await this.sync.ensureLoaded(owning.fileName);

      const tree = await this.cache.parse(document);
      const markdown = await computeHover(
        tree,
        document.offsetAt(position),
        owning.qualifiedName,
        client as HoverClient,
      );
      if (!markdown) return undefined;

      return new vscode.Hover(new vscode.MarkdownString(markdown));
    } catch (err) {
      log.error("language", "hover provider failed", err);
      return undefined;
    }
  }
}
