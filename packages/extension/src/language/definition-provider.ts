/**
 * Go-to-definition for Modelica buffers: parse → classify the cursor →
 * resolve the name to its owning class FQN → a `vscode.Location` at the
 * matching `modelica-source:/<FQN>.mo` virtual document.
 *
 * The target is the virtual document, not the on-disk `Uri.file(...)`, because
 * the editor-title commands (`Open Diagram from Source`, `Check Model`,
 * `View Source`) gate on `resourceScheme == modelica-source`; a `file:` target
 * would leave those dark on the landing page and let edits land on MSL files.
 * The virtual content is `list(<FQN>)` — a single class — so the site is always
 * `Position(0, 0)`, with no on-disk line numbers to convert.
 *
 * {@link computeDefinition} holds the resolution as plain data with no `vscode`
 * import (unit-tested against a mocked client); {@link ModelicaDefinitionProvider}
 * is the host wrapper.
 */

import * as vscode from "vscode";

import type { Tree } from "web-tree-sitter";

import { log } from "../logger.js";
import { sourceUriFor } from "../source-provider.js";

import { targetAt } from "./cursor.js";
import { resolveDocumentOwner } from "./document-scope.js";
import type { OwningClassClient } from "./owning-class.js";
import type { ParseCache } from "./parse.js";
import { resolve, type ResolveClient } from "./resolve.js";
import type { OmcSync } from "./sync.js";

/** A resolved definition site, as plain data (no `vscode` types). */
export interface DefinitionSite {
  /** Fully-qualified Modelica class name the target belongs to. */
  readonly qualifiedName: string;
}

/**
 * Pure resolution: the definition site for the cursor at `offset` in `tree`,
 * scoped to `owningClass`, or `undefined` when nothing resolves. No `vscode`
 * import — unit-tested directly against a mocked {@link ResolveClient}.
 *
 * @param tree - parsed buffer (from `ParseCache.parse`).
 * @param offset - UTF-16 code-unit offset (i.e. `document.offsetAt(position)`).
 * @param owningClass - fully-qualified name of the class the document defines.
 * @param client - structural OMC surface; a real `OmcClient` satisfies it.
 */
export async function computeDefinition(
  tree: Tree,
  offset: number,
  owningClass: string,
  client: ResolveClient,
): Promise<DefinitionSite | undefined> {
  const target = targetAt(tree, offset);
  if (!target) return undefined;

  return resolve(owningClass, target, client);
}

/**
 * The `vscode.DefinitionProvider` registered for Modelica buffers. Thin wrapper
 * over {@link computeDefinition}: parse, derive the owning class, ensure OMC has
 * the file loaded, resolve, then build a `vscode.Location` pointing at the
 * `modelica-source:` virtual document for the resolved class.
 */
export class ModelicaDefinitionProvider implements vscode.DefinitionProvider {
  constructor(
    private readonly cache: ParseCache,
    private readonly ensureClient: () => Promise<
      ResolveClient & OwningClassClient
    >,
    private readonly sync: OmcSync,
  ) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Location | undefined> {
    try {
      const client = await this.ensureClient();
      // Derive the owning class and load-on-touch (real files only; a virtual
      // `modelica-source:` class is already loaded — see `document-scope.ts`).
      const owning = await resolveDocumentOwner(document, client, this.sync);
      if (!owning) return undefined;

      // Bail between the load and resolve round-trips so a cursor that has
      // already moved on doesn't issue further OMC calls.
      if (token.isCancellationRequested) return undefined;

      const tree = await this.cache.parse(document);
      const site = await computeDefinition(
        tree,
        document.offsetAt(position),
        owning.qualifiedName,
        client,
      );
      if (!site) return undefined;

      // `list(<FQN>)` is the single class, so `(0, 0)` is its declaration.
      return new vscode.Location(
        sourceUriFor(site.qualifiedName),
        new vscode.Position(0, 0),
      );
    } catch (err) {
      // A provider must never throw out — degrade to "no definition".
      log.error("language", "definition provider failed", err);
      return undefined;
    }
  }
}
