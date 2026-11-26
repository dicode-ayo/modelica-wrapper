/**
 * Which file each top-level class in the shared OMC session was loaded from.
 *
 * Every workspace folder loads into one OMC session, so a second file
 * declaring a top-level class another file already supplied would silently
 * replace it. The workspace sweep, the `.mo` watcher and the buffer sync all
 * consult one instance before `loadFile`, and the watcher before
 * `deleteClass`, so a refused copy can neither replace the kept one nor
 * unload it.
 */

import * as path from "node:path";

import { scopeChain } from "@dicode/modelica-lang-core";

/**
 * A file left unloaded because a class it declares, or extends from inside
 * a refused copy's library, is already loaded from `keptFileName`.
 */
export interface NameCollision {
  className: string;
  keptFileName: string;
  refusedFileName: string;
}

const MAX_TOAST_COLLISIONS = 3;

/** Batch notification for every name collision one load refused. */
export function nameCollisionToast(collisions: NameCollision[]): string {
  const shown = collisions
    .slice(0, MAX_TOAST_COLLISIONS)
    .map(
      (c) =>
        `${c.refusedFileName} was not loaded: ${c.className} is already ` +
        `loaded from ${c.keptFileName}`,
    );
  const hidden = collisions.length - shown.length;
  if (hidden > 0) shown.push(`and ${hidden} more`);
  return (
    `Modelica: ${shown.join("; ")}. Entry files share one OpenModelica ` +
    `session, so only the copy of each class that loaded was kept.`
  );
}

export interface TopLevelClaims {
  /**
   * The collision that refuses loading `fsPath`, which declares
   * `classNames`, or `undefined` when it may load. A refused copy of a
   * top-level class is remembered, so the files inside its package and the
   * `within` extensions beside it are refused as well.
   */
  refusal(
    fsPath: string,
    classNames: readonly string[],
  ): NameCollision | undefined;
  /** Record `fsPath` as a copy refused in favour of the owner of `className`. */
  refuse(fsPath: string, className: string): void;
  /**
   * `fsPath` loaded declaring `classNames`: it owns each top-level one, and
   * gives up any top-level class it owned and no longer declares.
   */
  recordLoad(fsPath: string, classNames: readonly string[]): void;
  /** `fsPath` is gone: drop its refusal, and its claims with their refusals. */
  release(fsPath: string): void;
  /** The OMC session the claims describe was replaced (`:reset`). */
  clear(): void;
}

function outermost(qualifiedName: string): string | undefined {
  return scopeChain(qualifiedName).at(-1);
}

function isUnder(dir: string, fsPath: string): boolean {
  const rel = path.relative(dir, fsPath);
  return rel !== "" && rel.split(path.sep)[0] !== ".." && !path.isAbsolute(rel);
}

function isPackageFile(fsPath: string): boolean {
  return path.basename(fsPath) === "package.mo";
}

/** The directory a copy of a top-level class sits in, beside its `within` siblings. */
function libraryRoot(fsPath: string): string {
  const dir = path.dirname(fsPath);
  return isPackageFile(fsPath) ? path.dirname(dir) : dir;
}

export function createTopLevelClaims(): TopLevelClaims {
  // Owners keep the path they loaded under, so a report names the file the
  // way its loader did; comparisons go through `key`.
  const ownerByClass = new Map<string, string>();
  const refusedClassByFile = new Map<string, string>();
  const key = (p: string): string => path.resolve(p);

  /** Whether `fsPath`, declaring a class nested in `className`, extends a refused copy. */
  const refusedReach = (
    fsPath: string,
    className: string,
    owner: string,
  ): boolean => {
    for (const [refused, refusedClass] of refusedClassByFile) {
      if (refusedClass !== className) continue;
      if (isPackageFile(refused) && isUnder(path.dirname(refused), fsPath)) {
        return true;
      }
      // A `within` extension belongs to the library whose root sits closest
      // above it.
      const refusedRoot = libraryRoot(refused);
      const keptRoot = libraryRoot(key(owner));
      if (
        isUnder(refusedRoot, fsPath) &&
        (!isUnder(keptRoot, fsPath) || refusedRoot.length > keptRoot.length)
      ) {
        return true;
      }
    }
    return false;
  };

  return {
    refusal(rawPath, classNames) {
      const fsPath = key(rawPath);
      for (const declared of classNames) {
        const className = outermost(declared);
        if (className === undefined) continue;
        const owner = ownerByClass.get(className);
        if (owner === undefined || key(owner) === fsPath) continue;
        if (declared === className) {
          refusedClassByFile.set(fsPath, className);
        } else if (!refusedReach(fsPath, className, owner)) {
          continue;
        }
        return { className, keptFileName: owner, refusedFileName: rawPath };
      }
      return undefined;
    },
    refuse(rawPath, className) {
      refusedClassByFile.set(key(rawPath), className);
    },
    recordLoad(rawPath, classNames) {
      const fsPath = key(rawPath);
      const topLevel = new Set(classNames.filter((n) => outermost(n) === n));
      for (const [className, owner] of ownerByClass) {
        if (key(owner) === fsPath && !topLevel.has(className)) {
          ownerByClass.delete(className);
        }
      }
      for (const className of topLevel) ownerByClass.set(className, rawPath);
      refusedClassByFile.delete(fsPath);
    },
    release(rawPath) {
      const fsPath = key(rawPath);
      refusedClassByFile.delete(fsPath);
      for (const [className, owner] of ownerByClass) {
        if (key(owner) !== fsPath) continue;
        ownerByClass.delete(className);
        for (const [refused, refusedClass] of refusedClassByFile) {
          if (refusedClass === className) refusedClassByFile.delete(refused);
        }
      }
    },
    clear() {
      ownerByClass.clear();
      refusedClassByFile.clear();
    },
  };
}
