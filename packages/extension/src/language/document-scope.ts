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
 *     and waste a round-trip on every request (definition / hover / completion).
 *
 * Shared by the definition, hover and completion providers so this scheme rule
 * lives in exactly one place rather than being repeated in each.
 */

import * as vscode from "vscode";

import { MODELICA_SOURCE_SCHEME } from "../source-provider.js";

import {
  resolveOwningClass,
  type FileProbe,
  type OwningClass,
  type OwningClassClient,
} from "./owning-class.js";
import type { OmcSync } from "./sync.js";

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
 * @returns the owning class, or `undefined` when none can be derived.
 */
export async function resolveDocumentOwner(
  document: vscode.TextDocument,
  client: OwningClassClient,
  sync: Pick<OmcSync, "ensureLoaded">,
  options: { probe?: FileProbe } = {},
): Promise<OwningClass | undefined> {
  const isVirtual = document.uri.scheme === MODELICA_SOURCE_SCHEME;
  const owning = await resolveOwningClass(document.uri.fsPath, {
    client,
    pathIsQualifiedName: isVirtual,
    // Only forward a probe when one was supplied — `exactOptionalPropertyTypes`
    // forbids passing `probe: undefined` to the optional property.
    ...(options.probe ? { probe: options.probe } : {}),
  });
  if (!owning) return undefined;

  // A virtual source class is already loaded in OMC (and has no real path to
  // load); only real files need the load-on-touch.
  if (!isVirtual) {
    await sync.ensureLoaded(owning.fileName);
  }
  return owning;
}
