/**
 * Re-export of the shared class-to-file resolver, plus the editor's own
 * reader over it.
 *
 * `fileOwnerClass` lives in `@dicode/omc-client` beside the persistence that
 * consumes it, so the editor's save and the MCP server's `saveClass` resolve a
 * shared file the same way.
 */

import { isLikelyDiskPath, type FileOwnerClient } from "@dicode/omc-client";

export { fileOwnerClass, type FileOwnerClient } from "@dicode/omc-client";

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
