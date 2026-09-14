/**
 * The per-workspace OMC working directory. OMC `cd`s into it on connect (see
 * `extension.ts`), so every build artifact and `.mat` result file lands under
 * it — which is also where the postprocessing "add from cache" pick looks.
 */

import * as vscode from "vscode";

import { WORKSPACE_CACHE_DIRNAME } from "@dicode/omc-client";

export { WORKSPACE_CACHE_DIRNAME };

/** The cache directory of the first workspace folder, or `undefined` when no
 * folder is open. */
export function workspaceCacheUri(): vscode.Uri | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder
    ? vscode.Uri.joinPath(folder.uri, WORKSPACE_CACHE_DIRNAME)
    : undefined;
}
