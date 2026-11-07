import * as vscode from "vscode";

import { owningClassFromQualifiedName } from "./language/owning-class.js";
import { MODELICA_SOURCE_SCHEME } from "./source-provider.js";

/**
 * True when any class in `classNames`, or a class nested inside one, is open
 * and dirty as a custom editor over its `modelica-source:` URI, or when any
 * file in `fsPaths` is open and dirty as a plain text editor over the file on
 * disk. Reloading OMC under such a buffer would discard the unsaved edit.
 * Callers pass the full set a cascade can touch, not just the file the
 * triggering event named.
 */
export function isDeclaredClassBusy(
  fsPaths: string[],
  classNames: string[],
): boolean {
  const diskUris = new Set(fsPaths.map((p) => vscode.Uri.file(p).toString()));
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (!tab.isDirty) continue;
      const input = tab.input;
      if (
        input instanceof vscode.TabInputCustom &&
        input.uri.scheme === MODELICA_SOURCE_SCHEME
      ) {
        const open = owningClassFromQualifiedName(input.uri.fsPath);
        if (
          open !== undefined &&
          classNames.some(
            (c) =>
              open.qualifiedName === c ||
              open.qualifiedName.startsWith(`${c}.`),
          )
        ) {
          return true;
        }
      }
      if (
        input instanceof vscode.TabInputText &&
        diskUris.has(input.uri.toString())
      ) {
        return true;
      }
    }
  }
  return false;
}
