/**
 * Map a Modelica source document to the fully-qualified name of the class it
 * defines — the scope `qualifyPath` resolves names against.
 *
 * Modelica spec §13.4 ("Mapping package/class structure to a hierarchical file
 * system") allows two layouts:
 *
 *   1. Single-file — `A/B/Foo.mo` declares `model Foo` (possibly with a
 *      `within A.B;` clause). Owning class: `A.B.Foo`.
 *   2. Package-structured — `A/B/package.mo` declares `package B`, members
 *      live in `A/B/Resistor.mo`, `A/B/Sub/package.mo`, etc. Owning class of
 *      `A/B/Resistor.mo` is `A.B.Resistor`; of `A/B/package.mo` it is `A.B`.
 *
 * Entry points:
 *
 *   - {@link resolveOwningClass} — on-disk `.mo` paths. Walks ancestor
 *     directories collecting every one that contains a `package.mo` (those are
 *     Modelica packages); the leaf is confirmed via `parseFile` when a client
 *     is supplied so a `within`-clause file resolves correctly even if the
 *     filename disagrees with the declared class.
 *   - {@link owningClassFromQualifiedName} — `modelica-source:` virtual URIs
 *     whose basename is already the dotted FQN. Synchronous, no I/O.
 *
 * Filesystem and OMC are injected ({@link FileProbe} / {@link OwningClassClient})
 * so the module is unit-testable without real disk or a live OMC.
 */

import * as path from "node:path";

import { leafName } from "@dicode/modelica-lang-core";

import { pathExists } from "../fs-util.js";

export interface OwningClassClient {
  parseFile(input: { fileName: string }): Promise<{ classNames: string[] }>;
}

/** Does a path exist? Injectable so tests pass an in-memory set. */
export type FileProbe = (absolutePath: string) => Promise<boolean>;

export const PACKAGE_FILE = "package.mo";

export const nodeFileProbe: FileProbe = pathExists;

/** Owning class of an on-disk `.mo` document. */
export interface OwningClass {
  readonly qualifiedName: string;
  readonly fileName: string;
}

/** Owning class of a `modelica-source:` virtual URI; no on-disk backing file. */
export interface VirtualOwningClass {
  readonly qualifiedName: string;
}

/**
 * Owning class for an on-disk `.mo` path. Returns `undefined` for empty input,
 * a non-`.mo` extension, or a walk that yields no segments.
 *
 * For virtual `modelica-source:` URIs use {@link owningClassFromQualifiedName}.
 */
export async function resolveOwningClass(
  filePath: string,
  options: {
    client?: OwningClassClient;
    probe?: FileProbe;
  } = {},
): Promise<OwningClass | undefined> {
  const probe = options.probe ?? nodeFileProbe;
  if (filePath.length === 0) return undefined;
  // Reject `.txt` etc. — `stripMoExtension` would otherwise leak `.txt` into the leaf.
  if (path.extname(filePath).toLowerCase() !== ".mo") return undefined;

  // Case-insensitive to match `.mo` above (vendor libs ship `Package.mo` on
  // case-insensitive filesystems).
  const isPackageFile = path.basename(filePath).toLowerCase() === PACKAGE_FILE;
  // `B/package.mo`: walk starts from B's parent, B's basename is the leaf.
  // `B/Resistor.mo`: walk starts from B, filename (sans `.mo`) is the leaf.
  const startDir = isPackageFile
    ? path.dirname(path.dirname(filePath))
    : path.dirname(filePath);
  const leafDir = path.dirname(filePath);

  const candidateLeaf = isPackageFile
    ? path.basename(leafDir)
    : stripMoExtension(path.basename(filePath));

  // `confirmLeaf` doesn't depend on `prefix`; run them in parallel.
  const [prefix, confirmedLeaf] = await Promise.all([
    packagePrefix(startDir, probe),
    confirmLeaf(filePath, candidateLeaf, options.client),
  ]);

  // Plain file: only the confirmed leaf. package.mo: confirmed-or-dirname,
  // since the dirname is the class's name and parseFile can return empty.
  const leaf =
    confirmedLeaf.length > 0
      ? confirmedLeaf
      : isPackageFile
        ? candidateLeaf
        : "";
  const segments = leaf.length > 0 ? [...prefix, leaf] : [...prefix];

  const qualifiedName = segments.filter((s) => s.length > 0).join(".");
  if (qualifiedName.length === 0) return undefined;
  return { qualifiedName, fileName: filePath };
}

/**
 * Walk up from `dir` collecting basenames of every ancestor that contains
 * `package.mo`. Stops at the first non-package ancestor. Returned outermost-first.
 *
 * Probes the filesystem root too; `path.basename('/')` is `""` which the
 * caller's filter drops.
 */
async function packagePrefix(dir: string, probe: FileProbe): Promise<string[]> {
  const segmentsInnermostFirst: string[] = [];
  let current = dir;
  while (current) {
    const isPackage = await probe(path.join(current, PACKAGE_FILE));
    if (!isPackage) break;
    segmentsInnermostFirst.push(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) break; // filesystem root: dirname is stable.
    current = parent;
  }
  return segmentsInnermostFirst.reverse();
}

/**
 * `parseFile` reports a file's declared class names without loading it. A
 * single declared name is authoritative (handles filename mismatch and the
 * `within`-clause case); zero/many/no-client/throw falls back to `candidate`.
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
    const [only] = classNames;
    // `parseFile` may return a qualified name (within-clause); the prefix is
    // already supplied by the package walk so take the last segment only.
    // `noUncheckedIndexedAccess` types `only` as `string | undefined`.
    return only !== undefined ? leafName(only) : candidate;
  }
  return candidate;
}

function stripMoExtension(filename: string): string {
  return filename.replace(/\.mo$/i, "");
}

/**
 * Owning class for a path whose basename is already the dotted FQN — the shape
 * `modelica-source:` URIs produce. The basename sans `.mo` is taken verbatim;
 * no package walk, no `parseFile`.
 */
export function owningClassFromQualifiedName(
  filePath: string,
): VirtualOwningClass | undefined {
  if (filePath.length === 0) return undefined;
  if (path.extname(filePath).toLowerCase() !== ".mo") return undefined;
  const qualifiedName = stripMoExtension(path.basename(filePath));
  return qualifiedName.length > 0 ? { qualifiedName } : undefined;
}
