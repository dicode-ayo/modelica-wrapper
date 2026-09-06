/**
 * Derive the owning class of a Modelica document and ensure OMC has it loaded.
 *
 * Two document worlds reach the language providers:
 *
 *   - **Real `file:` documents** — walk the package structure (and confirm the
 *     leaf via `parseFile`) for the fully-qualified name, then load-on-touch so
 *     OMC's symbol table knows the file's classes.
 *   - **Virtual `modelica-source:` documents** — the `modelica.viewSource`
 *     editor renders an OMC class as `modelica-source:/<FQN>.mo`. The basename
 *     IS the fully-qualified name and the class is *already* loaded in OMC (its
 *     source came from there), so we take the FQN verbatim and skip the
 *     `loadFile` — which on a non-existent virtual path would only log a failure
 *     and waste a round-trip on every request.
 *
 * Shared by the language providers so this scheme rule lives in exactly one
 * place rather than being repeated in each.
 */

import * as vscode from "vscode";

import { MODELICA_SOURCE_SCHEME } from "../source-provider.js";

import {
  owningClassFromQualifiedName,
  resolveOwningClass,
  type FileProbe,
  type OwningClassClient,
} from "./owning-class.js";

/** Load tracker surface; the real `OmcSync` satisfies it. */
export interface DocumentSync {
  ensureLoaded(filePath: string): Promise<boolean>;
}

/**
 * Resolve the document's owning class and make sure OMC has it available.
 *
 * @param document - the Modelica buffer the cursor is in.
 * @param client - OMC surface for the `parseFile` leaf confirm (unused for the
 *   virtual scheme).
 * @param sync - buffer↔OMC load tracker; `ensureLoaded` is called for real
 *   files only.
 * @param options - `probe` overrides the package-directory filesystem check
 *   (the `resolveOwningClass` test seam); defaults to the real filesystem.
 * @returns the owning class FQN, or `undefined` when none can be derived.
 */
export async function resolveDocumentOwner(
  document: vscode.TextDocument,
  client: OwningClassClient,
  sync: DocumentSync,
  options: { probe?: FileProbe | undefined } = {},
): Promise<{ readonly qualifiedName: string } | undefined> {
  // Virtual `modelica-source:` URIs have the FQN as their basename and are
  // already loaded in OMC (their source came from there); no walk, no load.
  if (document.uri.scheme === MODELICA_SOURCE_SCHEME) {
    return owningClassFromQualifiedName(document.uri.fsPath);
  }
  const owning = await resolveOwningClass(document.uri.fsPath, {
    client,
    // `exactOptionalPropertyTypes` forbids passing `probe: undefined`.
    ...(options.probe ? { probe: options.probe } : {}),
  });
  if (!owning) return undefined;
  await sync.ensureLoaded(owning.fileName);
  return owning;
}
