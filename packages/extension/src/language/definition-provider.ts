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

import {
  resolve,
  targetAt,
  type ResolveClient,
} from "@dicode/modelica-lang-core";

import { log } from "../logger.js";
import { sourceUriFor } from "../source-provider.js";

import { runLanguageRequest } from "./language-request.js";
import type { OwningClassClient } from "./owning-class.js";
import type { ParseCache } from "./parse.js";
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

  return resolve(owningClass, target, client, log);
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
    return runLanguageRequest(document, position, token, {
      cache: this.cache,
      ensureClient: this.ensureClient,
      sync: this.sync,
      compute: computeDefinition,
      // `list(<FQN>)` is the single class, so `(0, 0)` is its declaration.
      map: (site) =>
        new vscode.Location(
          sourceUriFor(site.qualifiedName),
          new vscode.Position(0, 0),
        ),
      recheckTokenAfterCompute: false,
      failureContext: "definition provider failed",
    });
  }
}
