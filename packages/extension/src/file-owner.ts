/**
 * Resolves how a class maps onto its `.mo` file when several classes share one
 * (a package's inline members, a single-file package).
 *
 * A save must rewrite the whole file, not the one class being edited: OMC
 * stores inline members inside their package's `package.mo`, so writing just
 * the edited class's text over that file would drop every sibling. OMEdit saves
 * the file's outermost class (whose `listFile` re-serializes the whole file);
 * this finds that class.
 */

import { enclosingScope } from "@dicode/modelica-lang-core";

import { isLikelyDiskPath } from "./persist.js";

export interface FileOwnerClient {
  getSourceFile(input: { typeName: string }): Promise<{ fileName: string }>;
}

/**
 * The outermost enclosing class that still shares `className`'s source file.
 * Returns `className` itself when it owns its file (the one-class-per-file
 * case). Walks up the enclosing scopes while each parent's source file matches.
 */
export async function fileOwnerClass(
  client: FileOwnerClient,
  className: string,
): Promise<string> {
  const { fileName } = await client.getSourceFile({ typeName: className });
  let owner = className;
  for (let scope = enclosingScope(owner); scope !== "";) {
    let parentFile: string;
    try {
      parentFile = (await client.getSourceFile({ typeName: scope })).fileName;
    } catch {
      break;
    }
    if (parentFile !== fileName) break;
    owner = scope;
    scope = enclosingScope(owner);
  }
  return owner;
}

/**
 * Both the raw name OMC reports `typeName`'s source under, and that name
 * filtered down to a real on-disk path (`undefined` when it's a pseudo
 * filename like `<interactive>` or a `modelica-source:` URI, or the lookup
 * itself failed). One fetch serves a caller that needs the raw name (e.g. for
 * a resolver) and the screened path (e.g. for a `loadString` reload, which
 * binds a class to whatever filename it's given and would evict it from the
 * file it was actually stored in) without asking OMC for the same fact twice.
 */
export async function sourceFilenames(
  client: FileOwnerClient,
  typeName: string,
): Promise<{ reported: string; onDisk: string | undefined }> {
  let reported: string;
  try {
    reported = (await client.getSourceFile({ typeName })).fileName;
  } catch {
    reported = "";
  }
  return {
    reported,
    onDisk: isLikelyDiskPath(reported) ? reported : undefined,
  };
}

/**
 * The class's real on-disk source path, or `undefined` when it has none —
 * `typeName` is unknown to OMC, or the class is memory-only and carries a
 * pseudo-filename (`<interactive>`, a `modelica-source:` URI).
 */
export async function realSourceFilename(
  client: FileOwnerClient,
  typeName: string | undefined,
): Promise<string | undefined> {
  if (typeName === undefined) return undefined;
  return (await sourceFilenames(client, typeName)).onDisk;
}
