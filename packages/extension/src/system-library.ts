/**
 * Detects classes that belong to an installed **system library** — the ones
 * loaded from `MODELICAPATH` (`Modelica`, `Complex`, `ModelicaServices`,
 * `ModelicaReference`, …). These must not be edited even when their files are
 * writable on disk: a package-manager install under `~/.openmodelica/libraries/`
 * is owned by the user, so a file-permission check (`fileReadOnly`) treats it as
 * editable. Read-only is a property of a class's *origin*, not its file mode —
 * the same distinction OMEdit draws with `isSystemLibrary`.
 */

import * as path from "node:path";

import { isLikelyDiskPath } from "./persist.js";

export interface SystemLibraryClient {
  getSourceFile(input: { typeName: string }): Promise<{ fileName: string }>;
  getModelicaPath(): Promise<{ modelicaPath: string }>;
}

/**
 * True when `className`'s source file lives under a `MODELICAPATH` entry.
 *
 * Evaluate this *before* any mutating `loadString`: reflecting an editor buffer
 * back into OMC repoints the class's `fileName` to the `modelica-source:` URI,
 * after which the source location can no longer be compared against
 * `MODELICAPATH`. A non-disk `fileName` (empty, a `<runtime:…>` pseudo-path, or
 * an already-repointed URI) reads as not-a-system-library.
 */
export async function isSystemLibraryClass(
  client: SystemLibraryClient,
  className: string,
): Promise<boolean> {
  return (await systemLibraryVerdict(client, className)) === true;
}

/**
 * `true` / `false` when `className`'s origin is resolvable, `undefined` when it
 * isn't — a class not yet loaded (or already repointed to this scheme's URI)
 * has no on-disk source to classify. The `undefined` case must not be cached as
 * writable: a restored system-library editor resolves its class only when its
 * layout is fetched, so a verdict taken before that would strand it in edit
 * mode once the class loads.
 */
export async function systemLibraryVerdict(
  client: SystemLibraryClient,
  className: string,
): Promise<boolean | undefined> {
  const { fileName } = await client.getSourceFile({ typeName: className });
  if (!isLikelyDiskPath(fileName)) return undefined;
  const { modelicaPath } = await client.getModelicaPath();
  const roots = modelicaPath
    .split(path.delimiter)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  const file = path.resolve(fileName);
  return roots.some((root) => isUnder(file, path.resolve(root)));
}

/** True when `file` is `root` itself or nested beneath it. */
function isUnder(file: string, root: string): boolean {
  if (file === root) return true;
  const rel = path.relative(root, file);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}
