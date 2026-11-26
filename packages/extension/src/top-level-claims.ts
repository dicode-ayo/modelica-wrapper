/**
 * Which file each top-level class in the shared OMC session was loaded from.
 *
 * Every workspace folder loads into one OMC session, so a second file
 * declaring a top-level class another file already supplied would silently
 * replace it. The workspace sweep, the `.mo` watcher and the buffer sync all
 * consult one instance before `loadFile`, and the watcher before
 * `deleteClass`, so a refused copy can neither replace the kept one nor
 * unload it.
 *
 * The sweep decides which copy is kept. A load recorded while a sweep is
 * queued or running is provisional: it refuses nothing, and a sweep load of
 * another copy of the same class displaces it. Once every held sweep is done,
 * the provisional claims stand.
 */

import * as path from "node:path";

import { scopeChain } from "@dicode/modelica-lang-core";

import {
  defaultNormalizeKey,
  isInsideDirExclusive,
  isPackageFile,
} from "./fs-util.js";

/**
 * A file left unloaded because a class it declares, or extends from inside
 * a refused copy's library, is already loaded from `keptFileName`.
 */
export interface NameCollision {
  className: string;
  keptFileName: string;
  refusedFileName: string;
}

/** One collision, for the log. */
export function nameCollisionMessage(c: NameCollision): string {
  return `not loading ${c.refusedFileName}: ${c.className} is already loaded from ${c.keptFileName}`;
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

/** A refused copy of a top-level class. */
export interface RefusedCopy {
  fileName: string;
  className: string;
}

/** What a sweep held by {@link TopLevelClaims.holdForSweep} reads and records. */
export interface SweepClaims {
  refusal(
    fsPath: string,
    classNames: readonly string[],
  ): NameCollision | undefined;
  recordRefusal(
    collision: NameCollision,
    classNames: readonly string[],
  ): boolean;
  refuse(fsPath: string, className: string): void;
  /**
   * Like {@link TopLevelClaims.recordLoad}, but never provisional; a
   * provisional owner of another copy becomes a refused copy.
   */
  recordLoad(fsPath: string, classNames: readonly string[]): void;
  /** Releases the hold; called once the sweep settles, loaded or not. */
  done(): void;
}

export interface TopLevelClaims {
  /**
   * The collision that refuses loading `fsPath`, which declares
   * `classNames`, or `undefined` when it may load: another file owns one of
   * its top-level classes, or it sits inside a refused copy's package, or it
   * is a `within` extension whose nearest library root is a refused copy's.
   */
  refusal(
    fsPath: string,
    classNames: readonly string[],
  ): NameCollision | undefined;
  /**
   * Record a refusal {@link refusal} returned for `classNames`: a file
   * declaring the contested class itself becomes a refused copy. Returns
   * `true` the first time the refused file is reported, so every loader warns
   * about it once.
   */
  recordRefusal(
    collision: NameCollision,
    classNames: readonly string[],
  ): boolean;
  /** Record `fsPath` as a copy refused in favor of the owner of `className`. */
  refuse(fsPath: string, className: string): void;
  /**
   * `fsPath` loaded declaring `classNames`: it owns each top-level one, and
   * gives up any top-level class it owned and no longer declares.
   */
  recordLoad(fsPath: string, classNames: readonly string[]): void;
  /** The refused copies whose package holds `fsPath`, or that are `fsPath`. */
  refusedCopiesHolding(fsPath: string): RefusedCopy[];
  /** `fsPath` is gone: drop its refusal, and its claims with their refusals. */
  release(fsPath: string): void;
  /** The OMC session the claims describe was replaced (`:reset`). */
  clear(): void;
  /**
   * Make loads recorded from now on provisional until the returned sweep is
   * done. Call it when the sweep is queued, not when it starts.
   */
  holdForSweep(): SweepClaims;
}

interface Owner {
  /** As the loader named it, so a report does too. */
  fileName: string;
  provisional: boolean;
}

function outermost(qualifiedName: string): string | undefined {
  return scopeChain(qualifiedName).at(-1);
}

/** The directory a copy of a top-level class sits in, beside its `within` siblings. */
function libraryRoot(fsPath: string): string {
  const dir = path.dirname(fsPath);
  return isPackageFile(fsPath) ? path.dirname(dir) : dir;
}

export function createTopLevelClaims(
  normalizeKey: (filePath: string) => string = defaultNormalizeKey,
): TopLevelClaims {
  const ownerByClass = new Map<string, Owner>();
  const refusedByKey = new Map<string, RefusedCopy>();
  const reported = new Map<string, string>();
  let heldSweeps = 0;
  const key = (p: string): string => normalizeKey(path.resolve(p));

  /** Whether `fsPath`, declaring a class nested in `className`, extends a refused copy. */
  const refusedReach = (
    fsPath: string,
    className: string,
    owner: string,
  ): boolean => {
    const keptRoot = libraryRoot(key(owner));
    for (const [refused, copy] of refusedByKey) {
      if (copy.className !== className) continue;
      if (
        isPackageFile(refused) &&
        isInsideDirExclusive(path.dirname(refused), fsPath)
      ) {
        return true;
      }
      // A `within` extension belongs to the library whose root sits closest
      // above it.
      const refusedRoot = libraryRoot(refused);
      if (
        isInsideDirExclusive(refusedRoot, fsPath) &&
        (!isInsideDirExclusive(keptRoot, fsPath) ||
          refusedRoot.length > keptRoot.length)
      ) {
        return true;
      }
    }
    return false;
  };

  const refusal = (
    rawPath: string,
    classNames: readonly string[],
  ): NameCollision | undefined => {
    const fsPath = key(rawPath);
    for (const declared of classNames) {
      const className = outermost(declared);
      if (className === undefined) continue;
      const owner = ownerByClass.get(className);
      if (owner === undefined || owner.provisional) continue;
      if (key(owner.fileName) === fsPath) continue;
      if (
        declared !== className &&
        !refusedReach(fsPath, className, owner.fileName)
      ) {
        continue;
      }
      return {
        className,
        keptFileName: owner.fileName,
        refusedFileName: rawPath,
      };
    }
    return undefined;
  };

  const refuse = (rawPath: string, className: string): void => {
    refusedByKey.set(key(rawPath), { fileName: rawPath, className });
  };

  const recordRefusal = (
    collision: NameCollision,
    classNames: readonly string[],
  ): boolean => {
    if (classNames.includes(collision.className)) {
      refuse(collision.refusedFileName, collision.className);
    }
    const refusedKey = key(collision.refusedFileName);
    if (reported.has(refusedKey)) return false;
    reported.set(refusedKey, collision.className);
    return true;
  };

  const recordLoad = (
    rawPath: string,
    classNames: readonly string[],
    provisional: boolean,
  ): void => {
    const fsPath = key(rawPath);
    const topLevel = new Set(classNames.filter((n) => outermost(n) === n));
    for (const [className, owner] of ownerByClass) {
      if (key(owner.fileName) === fsPath && !topLevel.has(className)) {
        ownerByClass.delete(className);
      }
    }
    for (const className of topLevel) {
      const displaced = ownerByClass.get(className);
      if (
        !provisional &&
        displaced?.provisional === true &&
        key(displaced.fileName) !== fsPath
      ) {
        refuse(displaced.fileName, className);
      }
      ownerByClass.set(className, { fileName: rawPath, provisional });
    }
    refusedByKey.delete(fsPath);
    reported.delete(fsPath);
  };

  const dropRefusalsOf = (className: string): void => {
    for (const [refused, copy] of refusedByKey) {
      if (copy.className === className) refusedByKey.delete(refused);
    }
    for (const [file, reportedClass] of reported) {
      if (reportedClass === className) reported.delete(file);
    }
  };

  return {
    refusal,
    recordRefusal,
    refuse,
    recordLoad(rawPath, classNames) {
      recordLoad(rawPath, classNames, heldSweeps > 0);
    },
    refusedCopiesHolding(rawPath) {
      const fsPath = key(rawPath);
      return [...refusedByKey]
        .filter(
          ([refused]) =>
            refused === fsPath ||
            (isPackageFile(refused) &&
              isInsideDirExclusive(path.dirname(refused), fsPath)),
        )
        .map(([, copy]) => copy);
    },
    release(rawPath) {
      const fsPath = key(rawPath);
      refusedByKey.delete(fsPath);
      reported.delete(fsPath);
      for (const [className, owner] of ownerByClass) {
        if (key(owner.fileName) !== fsPath) continue;
        ownerByClass.delete(className);
        dropRefusalsOf(className);
      }
    },
    clear() {
      ownerByClass.clear();
      refusedByKey.clear();
      reported.clear();
    },
    holdForSweep() {
      heldSweeps++;
      let held = true;
      return {
        refusal,
        recordRefusal,
        refuse,
        recordLoad: (rawPath, classNames) =>
          recordLoad(rawPath, classNames, false),
        done() {
          if (!held) return;
          held = false;
          heldSweeps--;
          if (heldSweeps > 0) return;
          for (const owner of ownerByClass.values()) owner.provisional = false;
        },
      };
    },
  };
}
