/**
 * Whether this window has any Modelica in it.
 *
 * Contributing an MCP server definition provider makes VSCode activate the
 * extension in every window to ask what it offers, so activation no longer
 * implies a Modelica workspace the way the `workspaceContains` activation
 * event alone did.
 * The OpenModelica setup flow — the status item and the notification when no
 * `omc` is installed — is for someone who opened Modelica, not for someone who
 * happens to have an assistant attached.
 *
 * An open document is checked before the disk: a restored `modelica-source:`
 * editor is a reason on its own, and it can point at a library class no file in
 * the workspace mentions.
 */

import { MODELICA_DOC_SCHEME } from "./documentation/documentation-html-provider.js";
import { MODELICA_SOURCE_SCHEME } from "./source-provider.js";

/** The languages this extension owns, by the id its documents carry. */
const LANGUAGES = new Set(["modelica", "omresults"]);

const SCHEMES = new Set<string>([MODELICA_SOURCE_SCHEME, MODELICA_DOC_SCHEME]);

/** One open document, reduced to what the answer depends on. */
export interface OpenDocument {
  readonly languageId: string;
  readonly scheme: string;
}

export interface ModelicaWindowDeps {
  openDocuments: () => readonly OpenDocument[];
  /** The workspace's `.mo` files, memoized by the shared scanner. */
  scanMoFiles: () => Promise<readonly string[]>;
}

export async function hasModelicaContent(
  deps: ModelicaWindowDeps,
): Promise<boolean> {
  const open = deps
    .openDocuments()
    .some((d) => LANGUAGES.has(d.languageId) || SCHEMES.has(d.scheme));
  if (open) return true;
  return (await deps.scanMoFiles()).length > 0;
}
