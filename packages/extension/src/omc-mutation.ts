/**
 * Routes OMC's mutation announcements into an editor refresh.
 *
 * The client names what a command touched as far as the command string can
 * tell: a class, a file, or nothing more specific. A file is resolved to
 * classes here rather than downstream, because a file is an extension concept
 * and the invalidation registry is keyed by class.
 *
 * Named classes go to the source provider rather than straight to the
 * registry. Reloading the `modelica-source:` buffer is the point — a document
 * opened before a REPL mutation overwrites that mutation on its next save —
 * and the provider's broadcast is what reaches the buffer, the documentation
 * HTML and the diagram editors. `publishSourceChanges` turns that same
 * broadcast back into `classChanged`, so the caches follow without a second
 * announcement. A dirty buffer will not reload; that hazard needs conflict
 * detection and is not this seam's to solve.
 *
 * A file OMC was handed is one of three things: the `modelica-source:` URI a
 * memory-only class stays bound to until `setSourceFile` gives it a disk path,
 * a workspace `.mo` path the index already maps to the classes it declares, or
 * neither — a library outside the workspace, a file created after the index
 * was seeded, one of the `<runtime:…>` pseudo-names a class carries between
 * its creation and its first save. Only the last is coarse.
 */

import type { OmcMutation } from "@dicode/omc-client";

import {
  qualifiedNameFromUri,
  sourceUriFromOmcFilename,
} from "./source-provider.js";

/** The source provider, narrowed to the reload this triggers. */
export interface MutationSourceProvider {
  notifySourceChanged(typeName?: string): void;
}

/** The invalidation registry, narrowed to the signal no class name can carry. */
export interface MutationInvalidation {
  allClassesChanged(): void;
}

/** The path→class index, narrowed to the lookup a file-scoped mutation needs. */
export interface FileClassLookup {
  get(fsPath: string): string[] | undefined;
}

/** The client, narrowed to the subscription this attaches. */
export interface MutatingClient {
  onMutation(listener: (mutation: OmcMutation) => void): () => void;
}

/**
 * Route `client`'s mutations into an editor refresh. Returns the unsubscribe.
 *
 * Subscribe inside the client cache's spawn closure: `resetClient()` closes
 * the client and builds another, and a subscription attached to the handle
 * from outside would evaporate on `:reset` with nothing to show for it.
 */
export function publishOmcMutations(
  client: MutatingClient,
  source: MutationSourceProvider,
  invalidation: MutationInvalidation,
  index: FileClassLookup,
): () => void {
  return client.onMutation((mutation) => {
    applyOmcMutation(mutation, source, invalidation, index);
  });
}

/** Announce `mutation` at the narrowest scope it can be pinned to. */
export function applyOmcMutation(
  mutation: OmcMutation,
  source: MutationSourceProvider,
  invalidation: MutationInvalidation,
  index: FileClassLookup,
): void {
  const { scope } = mutation;
  if (scope.kind === "class") {
    source.notifySourceChanged(scope.className);
    return;
  }
  const names =
    scope.kind === "file" ? classesInFile(scope.fileName, index) : undefined;
  if (names === undefined || names.length === 0) {
    source.notifySourceChanged();
    invalidation.allClassesChanged();
    return;
  }
  for (const name of names) source.notifySourceChanged(name);
}

function classesInFile(
  fileName: string,
  index: FileClassLookup,
): string[] | undefined {
  const uri = sourceUriFromOmcFilename(fileName);
  if (uri !== undefined) {
    const className = qualifiedNameFromUri(uri);
    return className === undefined ? undefined : [className];
  }
  return index.get(fileName);
}
