/**
 * Writing a class OMC holds in memory out to a source tree.
 *
 * OMC's own `save` writes only to the path already recorded in its symbol
 * table and never touches `package.order`, so where the bytes land is the
 * caller's decision.
 *
 * A host supplies a root to write under and a {@link SourceWriter}. Every file
 * this creates goes through that writer, so a host can record what it wrote.
 */

import { mkdir, readFile } from "node:fs/promises";
import * as path from "node:path";

import { pathExists } from "./fs-util.js";

/** Where the bytes go. */
export interface SourceWriter {
  write(fsPath: string, text: string): Promise<void>;
}

/** The source tree a class is written into: a root, and a way to write. */
export interface SourceTree {
  readonly root: string;
  readonly writer: SourceWriter;
}

/** The OMC surface persistence is derived from. `OmcClient` satisfies it. */
export interface PersistClient {
  getClassInformation(input: { typeName: string }): Promise<{
    fileName: string;
  }>;
  getClassNames(input: { typeName: string }): Promise<{
    classNames: string[];
  }>;
  setSourceFile(input: {
    typeName: string;
    fileName: string;
  }): Promise<{ success: boolean }>;
}

/**
 * True if `s` looks like a real filesystem path we can hand to `fs.writeFile`.
 *
 * OMC's `fileName` field carries one of three things:
 *   - "" for built-in classes,
 *   - the `filename` argument from `loadString` (URIs like
 *     `modelica-source:/Foo.mo`, and `<runtime:Foo>` from a create flow),
 *   - an actual on-disk path for classes loaded from `.mo` files.
 * The first two crash `fs.writeFile` with ENOENT; this guard keeps them out.
 *
 * The colon test catches URI schemes (`modelica-source:`, `file:`) while
 * letting Windows drive letters (`C:\…`, single-char prefix) through.
 */
export function isLikelyDiskPath(s: string): boolean {
  if (!s) return false;
  if (s.startsWith("<")) return false;
  const colon = s.indexOf(":");
  if (colon > 1) return false;
  return true;
}

export interface PersistResult {
  /** Path of the leaf class file we wrote. */
  leafPath: string;
  /**
   * How the leaf's enclosing package is stored, or `undefined` for a leaf with
   * no parent. A `"directory"` package finds the leaf through the
   * `package.order` written beside it; a `"file"` package declares its members
   * inline, so nothing beside the leaf references it and only a loader reading
   * the leaf directly will see it.
   */
  enclosingPackage: "directory" | "file" | undefined;
  /**
   * Parents that ended up rooted under the tree's root because OMC didn't
   * already know an on-disk location for them. Caller should `setSourceFile`
   * each so OMC's symbol table tracks the new path.
   */
  newParents: Array<{ typeName: string; pkgFile: string }>;
}

/** A parent package that already has a place on disk. */
interface OnDiskParent {
  readonly dir: string;
  /**
   * Whether the package is a directory holding a `package.mo`, rather than a
   * single file declaring its members inline. Only the first has a
   * `package.order` that a new sibling file belongs in.
   */
  readonly structured: boolean;
}

/**
 * Materialize a class as nested directories with `package.mo` files mirroring
 * its dotted qualified name. Parents already on disk (per OMC's `fileName`)
 * are reused — the leaf is placed inside the deepest existing parent's
 * directory. Parents that exist in OMC memory only get fresh
 * `<dir>/package.mo` files under the tree's root. Existing `package.mo` files on
 * disk are never overwritten.
 *
 * The enclosing package's `package.order` gains the new member, so a fresh
 * OMC `loadFile` finds it. A `package.order` written from scratch alongside a
 * new `package.mo` lists the children OMC reports; an existing one is only
 * appended to, never rewritten — see {@link addToPackageOrder}. A directory
 * package this never created, and that has no `package.order`, keeps having
 * none.
 *
 * A `package` is written as `<baseDir>/<leafName>/package.mo` so its own
 * directory becomes the parent for subsequent children; every other
 * restriction is a single `<baseDir>/<leafName>.mo`.
 */
export async function persistClass(
  client: PersistClient,
  tree: SourceTree,
  qualifiedName: string,
  classText: string,
  restriction: string,
): Promise<PersistResult> {
  const { root, writer } = tree;
  const parts = qualifiedName.split(".");
  const newParents: PersistResult["newParents"] = [];
  let baseDir = root;
  let enclosing: OnDiskParent | undefined;
  for (let i = 0; i < parts.length - 1; i++) {
    const parentName = parts.slice(0, i + 1).join(".");
    const existing = await onDiskParent(client, parentName);
    if (existing !== undefined) {
      baseDir = existing.dir;
      enclosing = existing;
      continue;
    }
    const part = parts[i];
    if (part === undefined) continue;
    baseDir = path.join(baseDir, part);
    await mkdir(baseDir, { recursive: true });
    const pkgFile = path.join(baseDir, "package.mo");
    if (!(await pathExists(pkgFile))) {
      const within = parts.slice(0, i).join(".");
      const header = within ? `within ${within};\n` : "";
      await writer.write(pkgFile, `${header}package ${part}\nend ${part};\n`);
    }
    const orderFile = path.join(baseDir, "package.order");
    if (!(await pathExists(orderFile))) {
      const nextSegment = parts[i + 1];
      const base = await safeGetClassNames(client, parentName);
      const children =
        nextSegment !== undefined && !base.includes(nextSegment)
          ? [...base, nextSegment]
          : base;
      if (children.length > 0) {
        await writer.write(orderFile, children.join("\n") + "\n");
      }
    }
    enclosing = { dir: baseDir, structured: true };
    newParents.push({ typeName: parentName, pkgFile });
  }
  const enclosingPackage =
    enclosing === undefined
      ? undefined
      : enclosing.structured
        ? "directory"
        : "file";
  const leafName = parts.at(-1);
  if (leafName === undefined) {
    return { leafPath: "", newParents, enclosingPackage };
  }
  let leafPath: string;
  if (restriction === "package") {
    const leafDir = path.join(baseDir, leafName);
    await mkdir(leafDir, { recursive: true });
    leafPath = path.join(leafDir, "package.mo");
    const orderFile = path.join(leafDir, "package.order");
    if (!(await pathExists(orderFile))) {
      // Written even when the package has no members yet: it is what the next
      // class created inside gets appended to.
      const children = await safeGetClassNames(client, qualifiedName);
      await writer.write(
        orderFile,
        children.length === 0 ? "" : children.join("\n") + "\n",
      );
    }
  } else {
    leafPath = path.join(baseDir, `${leafName}.mo`);
    await mkdir(baseDir, { recursive: true });
  }
  await writer.write(leafPath, classText);
  if (enclosing?.structured === true) {
    await addToPackageOrder(writer, enclosing.dir, leafName);
  }
  return { leafPath, newParents, enclosingPackage };
}

/**
 * Apply `setSourceFile` for the leaf + each newly created parent. Parents go
 * first, so OMC sees the package files before the member class. Failures
 * bubble up — the caller decides whether to surface.
 */
export async function linkPersistedClass(
  client: PersistClient,
  typeName: string,
  result: PersistResult,
): Promise<void> {
  for (const p of result.newParents) {
    await client.setSourceFile({ typeName: p.typeName, fileName: p.pkgFile });
  }
  await client.setSourceFile({ typeName, fileName: result.leafPath });
}

/**
 * Add `member` to the `package.order` in `dir`, keeping the order already
 * there and writing nothing when the file is absent or already lists it.
 *
 * Only the member just written is added. `getClassNames` reports siblings that
 * live in OMC's symbol table and not on disk, and a name no file backs is
 * dropped with a warning on every load of the package.
 */
async function addToPackageOrder(
  writer: SourceWriter,
  dir: string,
  member: string,
): Promise<void> {
  const orderFile = path.join(dir, "package.order");
  let current: string;
  try {
    current = await readFile(orderFile, "utf8");
  } catch {
    return;
  }
  const members = current
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (members.includes(member)) return;
  await writer.write(orderFile, [...members, member].join("\n") + "\n");
}

async function onDiskParent(
  client: PersistClient,
  parentName: string,
): Promise<OnDiskParent | undefined> {
  try {
    const info = await client.getClassInformation({ typeName: parentName });
    if (isLikelyDiskPath(info.fileName)) {
      return {
        dir: path.dirname(info.fileName),
        structured: path.basename(info.fileName) === "package.mo",
      };
    }
  } catch {
    /* parent not in OMC — caller will create it */
  }
  return undefined;
}

const MODELICA_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function safeGetClassNames(
  client: PersistClient,
  typeName: string,
): Promise<string[]> {
  try {
    const { classNames } = await client.getClassNames({ typeName });
    return classNames.filter((n) => MODELICA_IDENT.test(n));
  } catch {
    return [];
  }
}
