/**
 * Go-to-definition provider — the navigable half of the hybrid loop (#97).
 *
 * The flow is: parse the buffer (`ParseCache`) → classify the cursor
 * (`cursor.ts`) → resolve the name to its owning class FQN (`resolve.ts`,
 * scoped to the document's owning class) → produce a `vscode.Location` that
 * points at the matching `modelica-source:/<FQN>.mo` virtual document.
 *
 * ## Why `modelica-source:` instead of the on-disk `Uri.file(...)`
 *
 * Resolving a name to "where is its class declared" has two faces in this
 * extension: the on-disk file OMC's `getClassInformation` reports
 * (`/usr/lib/omlibrary/.../Resistor.mo`), and the OMC-backed virtual document
 * the `ModelicaSourceProvider` serves at `modelica-source:/Modelica…Resistor.mo`.
 * The rest of the extension is built around the virtual scheme — the
 * `Open Diagram from Source`, `Check Model`, and `View Source` commands all
 * gate on `resourceScheme == modelica-source`. Sending go-to-definition to a
 * `Uri.file(...)` target silently disables those buttons for the navigation
 * landing page, splits the "how do you view a Modelica class" UX in two,
 * and lets users save edits straight onto MSL files on disk.
 *
 * Navigating to the virtual document also simplifies the position story:
 * the virtual content is `list(<FQN>)`, which is **just** that one class.
 * Top-of-document IS the class header. We always land at `Position(0, 0)` and
 * the cursor is at the right place — no on-disk-file line numbers to thread
 * through, no `getClassInformation` synthetic-location (`<interactive>` /
 * relative-path) filter to maintain.
 *
 * ## Pure / impure split (testability)
 *
 * The repo unit-tests pure logic against mocked OMC clients (see
 * `resolve.test.ts`), aliasing `vscode` only for the few value types tests
 * touch. To keep the navigation logic testable without an extension host, the
 * resolution lives in {@link computeDefinition}, which takes a tree-sitter
 * `Tree` + offset + owning class + a structural OMC surface and returns
 * **plain data** (`{ qualifiedName }`) with NO `vscode` import. The
 * `vscode.DefinitionProvider` wrapper ({@link ModelicaDefinitionProvider}) is a
 * thin shell that parses, derives the owning class, ensures the file is loaded,
 * calls `computeDefinition`, and builds the `vscode.Location`.
 *
 * Only typed `@dicode/omc-client` wrappers are used (via the `resolve.ts`
 * resolution layer) — never raw `client.call`. A resolution failure or OMC
 * error yields `undefined` (no navigation), never a thrown error out of the
 * provider.
 */

import * as vscode from "vscode";

import type { OmcClient } from "@dicode/omc-client";
import type { Tree } from "web-tree-sitter";

import { log } from "../logger.js";
import { sourceUriFor } from "../source-provider.js";

import { targetAt } from "./cursor.js";
import { resolveDocumentOwner } from "./document-scope.js";
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

  const resolved = await resolve(owningClass, target, client);
  if (!resolved || resolved.qualifiedName.length === 0) return undefined;

  return { qualifiedName: resolved.qualifiedName };
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

      // Land at the top of the virtual document — `list(<FQN>)` is the single
      // class, so `(0, 0)` IS the class declaration. No on-disk file positions
      // need conversion, and the editor-title commands gated on
      // `resourceScheme == modelica-source` light up on the navigation target.
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
