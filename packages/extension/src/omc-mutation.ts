/**
 * Turns an OMC mutation announcement into class-invalidation signals.
 *
 * The client names what a command touched as far as the command string can
 * tell: a class, a file, or nothing more specific. A class goes straight to
 * the registry. A file is resolved to classes here rather than there — the
 * registry is keyed by class, and a file is an extension concept that has no
 * business in it.
 *
 * A file OMC was handed is one of three things: the `modelica-source:` URI a
 * memory-only class stays bound to until `setSourceFile` gives it a disk path,
 * a workspace `.mo` path the watcher's index already maps to the classes it
 * declares, or neither — a library outside the workspace, a file created after
 * the index was seeded, one of the `<runtime:…>` pseudo-names a class carries
 * between its creation and its first save. Only the last is coarse.
 */

import * as vscode from "vscode";

import type { OmcMutation } from "@dicode/omc-client";

import {
  MODELICA_SOURCE_SCHEME,
  qualifiedNameFromUri,
} from "./source-provider.js";

/** The invalidation registry, narrowed to the two signals a mutation produces. */
export interface MutationInvalidation {
  classChanged(className: string): void;
  allClassesChanged(): void;
}

/** The `.mo` watcher's path→class index, narrowed to the lookup this needs. */
export interface ClassesByPath {
  get(fsPath: string): string[] | undefined;
}

/** Announce `mutation` to the caches, at the narrowest scope it can be pinned to. */
export function applyOmcMutation(
  mutation: OmcMutation,
  invalidation: MutationInvalidation,
  index: ClassesByPath,
): void {
  const { scope } = mutation;
  if (scope.kind === "class") {
    invalidation.classChanged(scope.className);
    return;
  }
  const names =
    scope.kind === "file" ? classesInFile(scope.fileName, index) : undefined;
  if (names === undefined || names.length === 0) {
    invalidation.allClassesChanged();
    return;
  }
  for (const name of names) invalidation.classChanged(name);
}

function classesInFile(
  fileName: string,
  index: ClassesByPath,
): string[] | undefined {
  if (fileName.startsWith(`${MODELICA_SOURCE_SCHEME}:`)) {
    const className = qualifiedNameFromUri(vscode.Uri.parse(fileName));
    return className === undefined ? undefined : [className];
  }
  return index.get(fileName);
}
