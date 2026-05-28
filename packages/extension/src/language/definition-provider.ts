/**
 * Go-to-definition provider — the navigable half of the hybrid loop (#97).
 *
 * The flow is: parse the buffer (`ParseCache`) → classify the cursor
 * (`cursor.ts`) → resolve the name to its definition + location (`resolve.ts`,
 * scoped to the document's owning class) → produce a `vscode.Location`.
 *
 * ## Pure / impure split (testability)
 *
 * The repo unit-tests pure logic against mocked OMC clients (see
 * `resolve.test.ts`), aliasing `vscode` only for the few value types tests
 * touch. To keep the navigation logic testable without an extension host, the
 * resolution + coordinate math lives in {@link computeDefinition}, which takes a
 * tree-sitter `Tree` + offset + owning class + a structural OMC surface and
 * returns **plain data** (`{ fileName, position }`) with NO `vscode` import. The
 * `vscode.DefinitionProvider` wrapper ({@link ModelicaDefinitionProvider}) is a
 * thin shell that parses, derives the owning class, ensures the file is loaded,
 * calls `computeDefinition`, and builds the `vscode.Location`.
 *
 * Only typed `@dicode/omc-client` wrappers are used (via the `resolve.ts`
 * resolution layer) — never raw `client.call`. A resolution failure or OMC
 * error yields `undefined` (no navigation), never a thrown error out of the
 * provider.
 */

import * as path from "node:path";

import * as vscode from "vscode";

import type { OmcClient } from "@dicode/omc-client";
import type { Tree } from "web-tree-sitter";

import { log } from "../logger.js";

import { targetAt } from "./cursor.js";
import { resolveDocumentOwner } from "./document-scope.js";
import type { ParseCache } from "./parse.js";
import type { ZeroBasedPosition } from "./position.js";
import { resolve, type ResolveClient } from "./resolve.js";
import type { OmcSync } from "./sync.js";

/** A resolved definition site, as plain data (no `vscode` types). */
export interface DefinitionSite {
  /** Absolute source file the definition lives in. */
  readonly fileName: string;
  /** 0-based VSCode position of the definition. */
  readonly position: ZeroBasedPosition;
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

  const resolved = await resolve(owningClass, target, client);
  if (!resolved) return undefined;

  // OMC's `getClassInformation` can return synthetic/non-filesystem locations —
  // `<interactive>` for an interactively-defined class, or a relative path —
  // which `vscode.Uri.file` would turn into a phantom file that "opens" on
  // click. `resolve.ts` only filters the empty case; reject anything that isn't
  // a real absolute path here so the wrapper never builds a bad `Location`.
  if (resolved.fileName.length === 0 || !path.isAbsolute(resolved.fileName)) {
    return undefined;
  }

  // `resolve.ts` already converted OMC's 1-based coordinates to 0-based.
  return {
    fileName: resolved.fileName,
    position: { line: resolved.line, character: resolved.column },
  };
}

/**
 * The `vscode.DefinitionProvider` registered for Modelica buffers. Thin wrapper
 * over {@link computeDefinition}: parse, derive the owning class, ensure OMC has
 * the file loaded, resolve, then build a `vscode.Location`.
 */
export class ModelicaDefinitionProvider implements vscode.DefinitionProvider {
  constructor(
    private readonly cache: ParseCache,
    private readonly ensureClient: () => Promise<OmcClient>,
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

      // The work above (ensureClient + a parseFile/loadFile round-trip for real
      // files) is serialized; on a fast-moving cursor the host may already have
      // abandoned this request. Bail before the resolve's further OMC calls.
      if (token.isCancellationRequested) return undefined;

      const tree = await this.cache.parse(document);
      const site = await computeDefinition(
        tree,
        document.offsetAt(position),
        owning.qualifiedName,
        client,
      );
      if (!site) return undefined;

      return new vscode.Location(
        vscode.Uri.file(site.fileName),
        new vscode.Position(site.position.line, site.position.character),
      );
    } catch (err) {
      // A provider must never throw out — degrade to "no definition".
      log.error("language", "definition provider failed", err);
      return undefined;
    }
  }
}
