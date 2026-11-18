/**
 * Routes OMC's mutation announcements into an editor refresh.
 *
 * The client names what a command touched as far as the command string, or a
 * typed call's input, can tell: a class, a file, a change to one class's
 * member list, or nothing more specific. A file is resolved to classes here
 * rather than downstream, because a file is an extension concept and the
 * invalidation registry is keyed by class.
 *
 * Named classes go to the source provider rather than straight to the
 * registry. Reloading the `modelica-source:` buffer is the point — a document
 * opened before a REPL mutation overwrites that mutation on its next save —
 * and the provider's broadcast is what reaches the buffer, the documentation
 * HTML and the diagram editors. `publishSourceChanges` turns that same
 * broadcast back into `classChanged`, so the caches follow without a second
 * announcement. A dirty buffer will not reload.
 *
 * A file OMC was handed is one of three things: the `modelica-source:` URI a
 * memory-only class stays bound to until `setSourceFile` gives it a disk path,
 * a workspace `.mo` path the index already maps to the classes it declares, or
 * neither — a library outside the workspace, a file created after the index
 * was seeded, one of the `<runtime:…>` pseudo-names a class carries between
 * its creation and its first save. Only the last is coarse.
 *
 * A member-list change rewrites the text of the parent and every class
 * enclosing it, any of which may own the file and would write the old listing
 * back on save. A created class can resolve a reference another class failed
 * on, a removal takes every class nested in it, and a reorder shifts the
 * in-file spans of its siblings; no cache is keyed so that a name or prefix
 * reaches those, so each raises the coarse signal as well. That signal fires
 * before the buffers reload, so the `classChanged` each reload sends finds the
 * caches already empty.
 */

import { isWithinScope, scopeChain } from "@dicode/modelica-lang-core";
import type { MutationScope, OmcMutation } from "@dicode/omc-client";

import {
  qualifiedNameFromUri,
  sourceUriFromOmcFilename,
} from "./source-provider.js";

/** The source provider, narrowed to the reloads this triggers. */
export interface MutationSourceProvider {
  notifySourceChanged(typeName?: string): void;
  notifySourcesChanged(typeNames: readonly string[]): void;
  openClassNames(): readonly string[];
}

/** The invalidation registry, narrowed to the signal no class name can carry. */
export interface MutationInvalidation {
  allClassesChanged(): void;
}

/** The path→class index, narrowed to the lookup a file-scoped mutation needs. */
export interface FileClassLookup {
  get(fsPath: string): string[] | undefined;
}

/** Everything an announcement can refresh. */
export interface MutationTargets {
  readonly source: MutationSourceProvider;
  readonly invalidation: MutationInvalidation;
  readonly index: FileClassLookup;
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
  targets: MutationTargets,
): () => void {
  return client.onMutation((mutation) => {
    applyOmcMutation(mutation, targets);
  });
}

/** Announce `mutation` at the narrowest scope it can be pinned to. */
export function applyOmcMutation(
  mutation: OmcMutation,
  targets: MutationTargets,
): void {
  const { scope } = mutation;
  const { source, invalidation } = targets;
  switch (scope.kind) {
    case "class":
      source.notifySourceChanged(scope.className);
      return;
    case "members":
      applyMembersChange(scope, targets);
      return;
    case "file": {
      const names = classesInFile(scope.fileName, targets.index);
      if (names !== undefined && names.length > 0) {
        source.notifySourcesChanged(names);
        return;
      }
      break;
    }
    case "coarse":
      break;
    default:
      return scope satisfies never;
  }
  invalidation.allClassesChanged();
  source.notifySourceChanged();
}

function applyMembersChange(
  scope: Extract<MutationScope, { kind: "members" }>,
  { source, invalidation }: MutationTargets,
): void {
  const { parent, created, removed } = scope;
  const rewritten = new Set(scopeChain(parent));
  const subtrees = [created, removed].filter(
    (root): root is string => root !== undefined,
  );
  const reload = source
    .openClassNames()
    .filter(
      (name) =>
        rewritten.has(name) ||
        subtrees.some((root) => isWithinScope(name, root)),
    );
  invalidation.allClassesChanged();
  if (reload.length > 0) source.notifySourcesChanged(reload);
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
