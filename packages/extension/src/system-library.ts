/**
 * Detects classes that belong to an installed **system library** — the ones
 * loaded from the installed `MODELICAPATH` (`Modelica`, `Complex`, `ModelicaServices`,
 * `ModelicaReference`, …). These must not be edited even when their files are
 * writable on disk: a package-manager install under `~/.openmodelica/libraries/`
 * is owned by the user, so a file-permission check (`fileReadOnly`) treats it as
 * editable. Read-only is a property of a class's *origin*, not its file mode —
 * the same distinction OMEdit draws with `isSystemLibrary`.
 *
 * This is one half of a write verdict; `write-verdict.ts` combines it with the
 * file permission and owns the per-class memo callers see. The `MODELICAPATH`
 * read underneath is shared per client.
 *
 * Only the installed default counts. A directory the user adds through
 * `modelica.modelicaPath` holds a vendored project library — theirs to edit,
 * not something a package manager installed for them.
 */

import * as path from "node:path";

import { isLikelyDiskPath } from "@dicode/omc-client";

export interface ModelicaPathReader {
  getModelicaPath(): Promise<{ modelicaPath: string }>;
}

export interface SystemLibraryClient extends ModelicaPathReader {
  getSourceFile(input: { typeName: string }): Promise<{ fileName: string }>;
}

/** `modelicaPath`'s entries, split on the only separator OMC honors. */
export function splitModelicaPath(modelicaPath: string): string[] {
  return modelicaPath
    .split(path.delimiter)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

/**
 * The first `MODELICAPATH` read on a client is the one every later verdict
 * uses, however the path changes afterwards. `applyModelicaPath` makes that
 * read before it widens the path, so the memo holds the installed default; a
 * later `setModelicaPath` — the setting's, or one typed into the REPL — moves
 * where OMC looks without moving what counts as a system library. A rejected
 * read is dropped so the next verdict asks again.
 */
const rootsByClient = new WeakMap<ModelicaPathReader, Promise<string[]>>();

/** The installed default library roots of `client`'s session. */
export function systemLibraryRoots(
  client: ModelicaPathReader,
): Promise<string[]> {
  const cached = rootsByClient.get(client);
  if (cached) return cached;
  const roots = client
    .getModelicaPath()
    .then(({ modelicaPath }) => splitModelicaPath(modelicaPath));
  rootsByClient.set(client, roots);
  roots.catch(() => {
    if (rootsByClient.get(client) === roots) rootsByClient.delete(client);
  });
  return roots;
}

/**
 * `true` / `false` when `className`'s origin is resolvable, `undefined` when it
 * isn't — a class not yet loaded (or repointed to an editor-buffer URI) has no
 * on-disk source to classify. `undefined` is inconclusive: the class may
 * resolve later, so callers must not treat it as a durable "writable".
 *
 * Evaluate this *before* any mutating `loadString`: reflecting an editor buffer
 * back into OMC repoints the class's `fileName` to the `modelica-source:` URI,
 * after which the source location can no longer be compared against the
 * library roots.
 */
export async function systemLibraryVerdict(
  client: SystemLibraryClient,
  className: string,
): Promise<boolean | undefined> {
  const { fileName } = await client.getSourceFile({ typeName: className });
  if (!isLikelyDiskPath(fileName)) return undefined;
  const roots = await systemLibraryRoots(client);
  const file = path.resolve(fileName);
  return roots.some((root) => isUnder(file, path.resolve(root)));
}

/** True when `file` is `root` itself or nested beneath it. */
function isUnder(file: string, root: string): boolean {
  if (file === root) return true;
  const rel = path.relative(root, file);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}
