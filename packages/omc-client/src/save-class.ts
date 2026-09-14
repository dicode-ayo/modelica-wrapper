/**
 * Writing a class OMC already holds out to the source tree it belongs in,
 * over the persistence in {@link persistClass}.
 *
 * `listFile` is the text. OMC re-derives it from its AST rather than echoing
 * the bytes on disk, so a save reflows the file — the class's formatting is
 * gone the moment OMC parses it, and nothing on this path can bring it back.
 */

import { fileOwnerClass, type FileOwnerClient } from "./file-owner.js";
import {
  isLikelyDiskPath,
  linkPersistedClass,
  persistClass,
  safeGetClassNames,
  type PersistClient,
  type SourceTree,
} from "./persist.js";

/** The OMC surface a save is derived from. `OmcClient` satisfies it. */
export interface SaveClient extends PersistClient, FileOwnerClient {
  listFile(input: { typeName: string }): Promise<{ contents: string }>;
  getClassInformation(input: { typeName: string }): Promise<{
    fileName: string;
    restriction: string;
  }>;
}

/** One class, and the file its text landed in. */
export interface SavedClass {
  readonly className: string;
  readonly fileName: string;
}

/** One class left unwritten, and why. */
export interface SkippedClass {
  readonly className: string;
  readonly reason: string;
}

export interface SaveResult {
  /** Every file written, in the order it was written. */
  readonly saved: SavedClass[];
  /** Classes {@link SaveOptions.authorize} refused, which nothing wrote. */
  readonly skipped: SkippedClass[];
  /** What was written but is not reachable from the tree it was written into. */
  readonly warnings: string[];
}

export interface SaveOptions {
  /**
   * Asked before each class is written; a string is the reason it may not be,
   * and that class and its members are left alone.
   *
   * A package reaches members the caller never named, and each of those is a
   * write in its own right — judging only the class the caller asked for would
   * let a member whose file sits outside the tree be written by a verdict that
   * never saw it. Skipping writes nothing, so a refusal mid-walk leaves no
   * half-written class behind.
   */
  readonly authorize?: (className: string) => Promise<string | undefined>;
}

/** The one walk, and what it accumulates. */
interface Walk {
  readonly client: SaveClient;
  readonly tree: SourceTree;
  readonly authorize: SaveOptions["authorize"];
  readonly saved: SavedClass[];
  readonly skipped: SkippedClass[];
  readonly warnings: string[];
  readonly seen: Set<string>;
}

/**
 * Write `className` to the source tree, and — when it is a package — every
 * member that does not already live in its file.
 *
 * A class OMC can place writes over the file it came from, through the file's
 * outermost class so inline siblings survive the write. One it cannot place is
 * materialized under the tree's root the way a newly created class is, gaining
 * a path, a `package.order` entry and a `setSourceFile` that points OMC at it.
 *
 * A member stored inline in its package's own file is skipped: writing the
 * package wrote it. One with a file of its own, and one OMC holds in memory
 * only, are each saved in turn.
 */
export async function saveClass(
  client: SaveClient,
  tree: SourceTree,
  className: string,
  options: SaveOptions = {},
): Promise<SaveResult> {
  const walk: Walk = {
    client,
    tree,
    authorize: options.authorize,
    saved: [],
    skipped: [],
    warnings: [],
    seen: new Set(),
  };
  await saveSubtree(walk, className);
  const { saved, skipped, warnings } = walk;
  return { saved, skipped, warnings };
}

async function saveSubtree(walk: Walk, className: string): Promise<void> {
  if (walk.seen.has(className)) return;
  walk.seen.add(className);

  const refusal = await walk.authorize?.(className);
  if (refusal !== undefined) {
    walk.skipped.push({ className, reason: refusal });
    return;
  }

  const { restriction } = await walk.client.getClassInformation({
    typeName: className,
  });
  const file = await writeOne(walk, className, restriction);
  if (restriction !== "package") return;

  for (const member of await safeGetClassNames(walk.client, className)) {
    const memberName = `${className}.${member}`;
    // A member OMC reports in the file just written is inside it, so writing
    // it again would give one class two homes.
    if ((await sourceFileOf(walk.client, memberName)) === file) continue;
    await saveSubtree(walk, memberName);
  }
}

/**
 * Write `className`'s text, and report the file it went to.
 *
 * The file is what the members of a package are then compared against, so it
 * is the path OMC records after the write rather than the one it held before.
 */
async function writeOne(
  walk: Walk,
  className: string,
  restriction: string,
): Promise<string> {
  const { client, tree } = walk;
  const { fileName } = await client.getSourceFile({ typeName: className });
  if (!isLikelyDiskPath(fileName)) {
    const result = await persistClass(
      client,
      tree,
      className,
      await sourceText(client, className),
      restriction,
    );
    await linkPersistedClass(client, className, result);
    walk.saved.push({ className, fileName: result.leafPath });
    if (result.enclosingPackage === "file") {
      walk.warnings.push(inlineParentWarning(className, result.leafPath));
    }
    return result.leafPath;
  }

  // A class stored inside its package's file is not the whole of that file.
  // Writing its own text over the file would drop every sibling declared
  // beside it, so the outermost class sharing the file supplies the text.
  const owner = await fileOwnerClass(client, className);
  await tree.writer.write(fileName, await sourceText(client, owner));
  walk.saved.push({ className: owner, fileName });
  return fileName;
}

/**
 * What to tell a caller whose class landed beside a package stored as one file
 * rather than inside a directory package.
 *
 * The file is written, but a single-file package declares its members inline
 * and has no `package.order`, so nothing beside it names the new file and
 * loading the package on its own will not bring the class in.
 */
function inlineParentWarning(className: string, leafPath: string): string {
  return `${className} was written to ${leafPath}, but its package is stored as a single file rather than a directory package, so nothing there names it — loading that package on its own will not bring ${className} in.`;
}

/**
 * `className`'s Modelica source, with the trailing newline OMC's unparser
 * leaves off.
 *
 * Empty text is refused rather than written: a class never legitimately has
 * none, so an empty listing is OMC failing to answer, and writing it would
 * truncate a real file — taking every class in it, not just this one.
 */
async function sourceText(
  client: SaveClient,
  className: string,
): Promise<string> {
  const { contents } = await client.listFile({ typeName: className });
  if (contents.trim() === "") {
    throw new Error(
      `OMC listed no source for ${className}, so there is nothing to write — saving would empty its file.`,
    );
  }
  return contents.endsWith("\n") ? contents : `${contents}\n`;
}

/** The file OMC has `className` under, or `undefined` when it has no answer. */
async function sourceFileOf(
  client: SaveClient,
  className: string,
): Promise<string | undefined> {
  try {
    const { fileName } = await client.getSourceFile({ typeName: className });
    return fileName;
  } catch {
    return undefined;
  }
}
