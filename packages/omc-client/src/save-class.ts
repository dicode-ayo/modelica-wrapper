/**
 * Writing a class OMC already holds out to the source tree it belongs in.
 *
 * `createClass` writes a file once, at creation. Every edit after it —
 * `addComponent`, `addConnection`, `setElementModifierValue`, a reload through
 * `loadString` — changes OMC's symbol table and stops there, so a model built
 * through those calls lives in memory until something writes it back.
 *
 * OMC's own `save` is not that something. It writes only to the path already
 * recorded in the symbol table, which for a class created here is still a
 * `<runtime:…>` placeholder; it never touches `package.order`; and on a package
 * it writes the `package.mo` and none of the children. This composes the same
 * persistence {@link persistClass} gives `createClass` instead.
 *
 * `listFile` is the text. OMC re-derives it from its AST rather than echoing
 * the bytes on disk, so a save reflows the file the way `save` does — the
 * class's formatting is gone the moment OMC parses it, and nothing on this
 * path can bring it back.
 */

import { fileOwnerClass, type FileOwnerClient } from "./file-owner.js";
import {
  isLikelyDiskPath,
  linkPersistedClass,
  persistClass,
  type PersistClient,
  type SourceTree,
} from "./persist.js";
import { MODELICA_IDENT } from "./_shared/fields.js";

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

export interface SaveResult {
  /** Every file written, in the order it was written. */
  readonly saved: SavedClass[];
  /** What was written but is not reachable from the tree it was written into. */
  readonly warnings: string[];
}

/** What a save accumulates as it walks. */
interface Run {
  readonly saved: SavedClass[];
  readonly warnings: string[];
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
 * only, are each saved in turn — the second is the case `save` cannot reach and
 * the reason a package recurses at all.
 */
export async function saveClass(
  client: SaveClient,
  tree: SourceTree,
  className: string,
): Promise<SaveResult> {
  const run: Run = { saved: [], warnings: [] };
  await saveSubtree(client, tree, className, run, new Set());
  return run;
}

async function saveSubtree(
  client: SaveClient,
  tree: SourceTree,
  className: string,
  run: Run,
  seen: Set<string>,
): Promise<void> {
  if (seen.has(className)) return;
  seen.add(className);

  const { restriction } = await client.getClassInformation({
    typeName: className,
  });
  const file = await writeOne(client, tree, className, restriction, run);
  if (restriction !== "package") return;

  for (const member of await memberNames(client, className)) {
    const memberName = `${className}.${member}`;
    // A member OMC reports in the file just written is inside it, so writing
    // it again would give one class two homes.
    if ((await sourceFileOf(client, memberName)) === file) continue;
    await saveSubtree(client, tree, memberName, run, seen);
  }
}

/**
 * Write `className`'s text, and report the file it went to.
 *
 * The file is what the members of a package are then compared against, so it
 * is the path OMC records after the write rather than the one it held before.
 */
async function writeOne(
  client: SaveClient,
  tree: SourceTree,
  className: string,
  restriction: string,
  run: Run,
): Promise<string> {
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
    run.saved.push({ className, fileName: result.leafPath });
    if (result.enclosingPackage === "file") {
      run.warnings.push(inlineParentWarning(className, result.leafPath));
    }
    return result.leafPath;
  }

  // A class stored inside its package's file is not the whole of that file.
  // Writing its own text over the file would drop every sibling declared
  // beside it, so the outermost class sharing the file supplies the text.
  const owner = await fileOwnerClass(client, className);
  await tree.writer.write(fileName, await sourceText(client, owner));
  run.saved.push({ className: owner, fileName });
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

/**
 * The member names of `className`, as OMC reports them. A name that is not an
 * identifier is not a class this can qualify, so it is dropped rather than
 * concatenated into one OMC would reject.
 */
async function memberNames(
  client: SaveClient,
  className: string,
): Promise<string[]> {
  try {
    const { classNames } = await client.getClassNames({ typeName: className });
    return classNames.filter((n) => MODELICA_IDENT.test(n));
  } catch {
    return [];
  }
}
