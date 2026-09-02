/**
 * Routes OMC's mutation announcements into class-invalidation signals.
 *
 * The client names what a command touched as far as the command string can
 * tell: a class, a file, or nothing more specific. A file is resolved to
 * classes here rather than in the registry, which is keyed by class and has no
 * business knowing about paths.
 *
 * A file OMC was handed is one of three things: the `modelica-source:` URI a
 * memory-only class stays bound to until `setSourceFile` gives it a disk path,
 * a workspace `.mo` path the index already maps to the classes it declares, or
 * neither — a library outside the workspace, a file created after the index
 * was seeded, one of the `<runtime:…>` pseudo-names a class carries between
 * its creation and its first save. Only the last is coarse.
 */

import type { OmcMutation } from "@dicode/omc-client";

import type { PathClassIndex } from "./path-class-index.js";
import {
  qualifiedNameFromUri,
  sourceUriFromOmcFilename,
} from "./source-provider.js";

/** The invalidation registry, narrowed to the two signals a mutation produces. */
export interface MutationInvalidation {
  classChanged(className: string): void;
  allClassesChanged(): void;
}

/** The client, narrowed to the subscription this attaches. */
export interface MutatingClient {
  onMutation(listener: (mutation: OmcMutation) => void): () => void;
}

/**
 * Route `client`'s mutations into `invalidation`. Returns the unsubscribe.
 *
 * Subscribe inside the client cache's spawn closure: `resetClient()` closes
 * the client and builds another, and a subscription attached to the handle
 * from outside would evaporate on `:reset` with nothing to show for it.
 */
export function publishOmcMutations(
  client: MutatingClient,
  invalidation: MutationInvalidation,
  index: Pick<PathClassIndex, "get">,
): () => void {
  return client.onMutation((mutation) => {
    applyOmcMutation(mutation, invalidation, index);
  });
}

/** Announce `mutation` at the narrowest scope it can be pinned to. */
export function applyOmcMutation(
  mutation: OmcMutation,
  invalidation: MutationInvalidation,
  index: Pick<PathClassIndex, "get">,
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
  index: Pick<PathClassIndex, "get">,
): string[] | undefined {
  const uri = sourceUriFromOmcFilename(fileName);
  if (uri === undefined) return index.get(fileName);
  const className = qualifiedNameFromUri(uri);
  return className === undefined ? undefined : [className];
}
