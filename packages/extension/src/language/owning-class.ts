/**
 * Map a Modelica source document to the fully-qualified name of the class it
 * defines — the "owning class" that `resolve.ts` qualifies names *against*.
 *
 * ## Why this is needed
 *
 * `qualifyPath(classScope, shortName)` resolves a short name in the scope of a
 * class. To call it we must first know which class the editor buffer *is*. A
 * `.mo` file's class name is not the file path: it's the path's position inside
 * the Modelica package structure. This module reconstructs that.
 *
 * ## The two file layouts (Modelica spec §13.4 "Mapping package/class
 * structure to a hierarchical file system")
 *
 *   1. **Single-file** — `Foo.mo` declares `model Foo … end Foo;` (possibly with
 *      a `within A.B;` clause). The owning class is `A.B.Foo`.
 *   2. **Package-structured** — a directory `B/` with `B/package.mo` declares
 *      `package B …`, and members live in `B/Resistor.mo`, `B/Sub/package.mo`,
 *      etc. The owning class of `A/B/Resistor.mo` is `A.B.Resistor`; of
 *      `A/B/package.mo` it is `A.B`.
 *
 * The package prefix is derived by walking *up* the directory tree collecting
 * every ancestor directory that contains a `package.mo` (those are Modelica
 * packages); the walk stops at the first ancestor that is **not** a package.
 *
 * ## Confirmation via `parseFile`
 *
 * The path walk gives a *candidate* leaf name (from the filename, or the
 * directory name for `package.mo`). We confirm the leaf against
 * [`parseFile`](../../../omc-client/src/api/lifecycle/parseFile.ts), which
 * returns the class names a file actually declares *without loading it*. If the
 * file declares exactly one class we use that name (it is authoritative — it
 * survives a filename that doesn't match the class, and resolves the
 * `within`-prefixed package case). When `parseFile` is unavailable or
 * ambiguous, we fall back to the filename-derived candidate.
 *
 * ## Purity / testability
 *
 * Filesystem access and OMC are **injected** (`FileProbe` / `OwningClassClient`)
 * so the whole module is unit-testable with a plain in-memory map and a stub
 * client — no real disk, no live OMC (mirrors `workspace-scan.ts` and
 * `omc-snapshot.ts`). The default probe uses `node:fs/promises`.
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";

/** The single OMC call this module makes — the typed `parseFile` wrapper. */
export interface OwningClassClient {
  parseFile(input: { fileName: string }): Promise<{ classNames: string[] }>;
}

/**
 * Filesystem capability this module needs: does a path exist? Injectable so
 * tests pass an in-memory set instead of touching disk. Defaults to
 * {@link nodeFileProbe}.
 */
export type FileProbe = (absolutePath: string) => Promise<boolean>;

/** The conventional name of a Modelica structured-package directory marker. */
export const PACKAGE_FILE = "package.mo";

/** Default {@link FileProbe} backed by `node:fs/promises`. */
export const nodeFileProbe: FileProbe = async (p) => {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * The resolved owning class of a document.
 */
export interface OwningClass {
  /** Fully-qualified Modelica class name, e.g. `Modelica.Electrical.Resistor`. */
  readonly qualifiedName: string;
  /** Absolute path of the source file the class is defined in. */
  readonly fileName: string;
}

/**
 * Resolve the owning class for a Modelica file path.
 *
 * @param filePath - absolute path to a `.mo` file (the document's `fsPath`).
 * @param options - injected dependencies. `client` (optional) supplies
 *   `parseFile` for authoritative leaf-name confirmation; `probe` (optional)
 *   answers package-directory existence (defaults to the real filesystem).
 *   `pathIsQualifiedName` (optional) short-circuits both for a virtual source
 *   path whose basename is already the dotted FQN — see below.
 * @returns the owning class, or `undefined` if no Modelica name can be derived
 *   (the path is empty or not a `.mo` file, or the walk yields no segments).
 */
export async function resolveOwningClass(
  filePath: string,
  options: {
    client?: OwningClassClient;
    probe?: FileProbe;
    /**
     * The path's basename is already the fully-qualified dotted name, e.g. the
     * virtual `modelica-source:/A.B.C.mo` view of an OMC class. When set, skip
     * the package-prefix walk and the `parseFile` confirm and use the basename
     * (sans `.mo`) verbatim — there is no real file on disk to probe or parse,
     * and `parseFile` on such a path could otherwise truncate the FQN to its
     * last segment.
     */
    pathIsQualifiedName?: boolean;
  } = {},
): Promise<OwningClass | undefined> {
  const probe = options.probe ?? nodeFileProbe;
  if (filePath.length === 0) return undefined;
  // Self-defensive: only Modelica source files have a derivable owning class.
  // Without this, a non-`.mo` path like `/work/Foo.txt` would slip through
  // `stripMoExtension` unchanged and produce a bogus dotted leaf (`Foo.txt`).
  if (path.extname(filePath).toLowerCase() !== ".mo") return undefined;

  // Virtual source path (`modelica-source:/A.B.C.mo`): the basename IS the FQN.
  // Take it verbatim — no package walk, no parseFile (the path is not a real
  // file, so probing/parsing it is wasted and parseFile could truncate the FQN).
  if (options.pathIsQualifiedName) {
    const qualifiedName = stripMoExtension(path.basename(filePath));
    return qualifiedName.length > 0 ? { qualifiedName, fileName: filePath } : undefined;
  }

  const isPackageFile = path.basename(filePath) === PACKAGE_FILE;
  // For `B/package.mo` the owning *directory* (B) is itself a package member, so
  // the package prefix walk starts from B's parent and B's basename is the leaf.
  // For a plain `B/Resistor.mo` the prefix walk starts from B and the filename
  // (sans extension) is the candidate leaf.
  const startDir = isPackageFile
    ? path.dirname(path.dirname(filePath))
    : path.dirname(filePath);
  const leafDir = path.dirname(filePath);

  const prefix = await packagePrefix(startDir, probe);

  // The candidate leaf segment from the path.
  const candidateLeaf = isPackageFile
    ? path.basename(leafDir)
    : stripMoExtension(path.basename(filePath));

  // Confirm the leaf via parseFile when a client is available. parseFile
  // returns the (top-level) class names the file declares; a single name is
  // authoritative for the leaf segment regardless of filename mismatch.
  const confirmedLeaf = await confirmLeaf(
    filePath,
    candidateLeaf,
    options.client,
  );

  const segments = [...prefix];
  if (confirmedLeaf.length > 0 && !isPackageFile) {
    // For package.mo the directory name is ALREADY the leaf (and is part of the
    // prefix walk's sibling chain); only standalone files add a leaf segment.
    segments.push(confirmedLeaf);
  } else if (isPackageFile) {
    segments.push(confirmedLeaf.length > 0 ? confirmedLeaf : candidateLeaf);
  }

  const qualifiedName = segments.filter((s) => s.length > 0).join(".");
  if (qualifiedName.length === 0) return undefined;
  return { qualifiedName, fileName: filePath };
}

/**
 * Walk up from `dir`, collecting the basenames of every ancestor directory
 * that is a Modelica package (contains a `package.mo`). The walk stops at the
 * first ancestor that is NOT a package — that boundary is the workspace/library
 * root. Returned outermost-first so the segments join into a dotted prefix.
 */
async function packagePrefix(
  dir: string,
  probe: FileProbe,
): Promise<string[]> {
  const segmentsInnermostFirst: string[] = [];
  let current = dir;
  // Guard against an infinite loop at the filesystem root (dirname is stable).
  while (current && path.dirname(current) !== current) {
    const isPackage = await probe(path.join(current, PACKAGE_FILE));
    if (!isPackage) break;
    segmentsInnermostFirst.push(path.basename(current));
    current = path.dirname(current);
  }
  return segmentsInnermostFirst.reverse();
}

/**
 * Confirm the leaf class name via `parseFile`. When the file declares exactly
 * one top-level class, that name wins (authoritative — survives a filename that
 * differs from the class name). For zero or multiple declared names, or when no
 * client is supplied / the call fails, fall back to the path-derived candidate.
 */
async function confirmLeaf(
  filePath: string,
  candidate: string,
  client: OwningClassClient | undefined,
): Promise<string> {
  if (!client) return candidate;
  let classNames: string[];
  try {
    ({ classNames } = await client.parseFile({ fileName: filePath }));
  } catch {
    return candidate;
  }
  if (classNames.length === 1) {
    // parseFile may return a qualified name for a within-clause file; take the
    // last dotted segment as the leaf (the prefix is already supplied by the
    // package walk).
    return lastSegment(classNames[0] ?? candidate);
  }
  // Ambiguous (0 or >1 declared classes): parseFile cannot single out the leaf,
  // so we keep the deterministic path-derived candidate either way. (Whether the
  // candidate happens to be among the declared names doesn't change the result —
  // there's no better leaf to return — so we don't branch on it.)
  return candidate;
}

/** Last dotted segment of a possibly-qualified name (`A.B.C` → `C`). */
function lastSegment(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? name : name.slice(dot + 1);
}

/** Strip a trailing `.mo` (case-insensitive) from a filename. */
function stripMoExtension(filename: string): string {
  return filename.replace(/\.mo$/i, "");
}
