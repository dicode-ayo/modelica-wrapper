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

export interface FileParseClient {
  parseFile(input: { fileName: string }): Promise<{ classNames: string[] }>;
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
  for (let scope = enclosingScope(owner); scope !== ""; ) {
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
 * Every top-level class `fileName` currently declares on disk, in file order —
 * `fileOwnerClass`'s result included, but not necessarily alone. `fileOwnerClass`
 * only climbs `className`'s own dotted-namespace ancestry; it has no way to see
 * an unrelated top-level class declared elsewhere in the same file (valid
 * Modelica: a file can hold several top-level class statements in sequence,
 * with no dotted relationship between them). A file with exactly one owns it
 * outright; more than one means writing just the owner's own listing would
 * drop the rest.
 */
export async function fileTopLevelSiblings(
  client: FileParseClient,
  fileName: string,
): Promise<string[]> {
  const { classNames } = await client.parseFile({ fileName });
  return classNames.filter((name) => enclosingScope(name) === "");
}

/**
 * The class's real on-disk source path, or `undefined` when it has none —
 * `typeName` is unknown to OMC, or the class is memory-only and carries a
 * pseudo-filename (`<interactive>`, a `modelica-source:` URI).
 *
 * `loadString` binds a class to whatever filename it is given, evicting it from
 * the file it was stored in, so every buffer reload must pass this path rather
 * than the per-class URI it was read through.
 */
export async function realSourceFilename(
  client: FileOwnerClient,
  typeName: string | undefined,
): Promise<string | undefined> {
  if (typeName === undefined) return undefined;
  try {
    const { fileName } = await client.getSourceFile({ typeName });
    return isLikelyDiskPath(fileName) ? fileName : undefined;
  } catch {
    return undefined;
  }
}
