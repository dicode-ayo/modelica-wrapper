/**
 * Which file each class in the shared OMC session was loaded from.
 *
 * Every workspace folder loads into one OMC session, so a second file
 * declaring a class another file already supplied would silently replace it.
 * The workspace sweep, the `.mo` watcher and the buffer sync all consult one
 * instance before `loadFile`, and the watcher before `deleteClass`, so a
 * refused copy can neither replace the kept one nor unload it.
 *
 * The sweep decides which copy is kept: while a sweep is held (see
 * {@link TopLevelClaims.hold}) the watcher and the sync wait on
 * {@link TopLevelClaims.settled} before loading anything.
 */

import * as path from "node:path";

import { isWithinScope, scopeChain } from "@dicode/modelica-lang-core";

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
    `Modelica: ${shown.join("; ")}. Workspace files share one OpenModelica ` +
    `session, so only the copy of each class that loaded was kept.`
  );
}

/** A refused copy of a class. */
export interface RefusedCopy {
  fileName: string;
  className: string;
}

/** A claim taken before `loadFile`, so a racing load of another copy is refused. */
export interface Reservation {
  /** The load succeeded: record it as {@link TopLevelClaims.recordLoad} does. */
  commit(): void;
  /** The load failed or was skipped: drop the claims this reservation took. */
  cancel(): void;
}

export interface TopLevelClaims {
  /**
   * The collision that refuses loading `fsPath`, which declares
   * `classNames`, or `undefined` when it may load: another file owns one of
   * those classes, or `fsPath` sits inside a refused copy's package, or it is
   * a `within` extension whose nearest library root is a refused copy's.
   */
  refusal(
    fsPath: string,
    classNames: readonly string[],
  ): NameCollision | undefined;
  /** Whether OMC's `className` can be `fsPath`'s: no {@link refusal} for it. */
  supplies(fsPath: string, className: string): boolean;
  /**
   * Claim each unowned class of `classNames` for `fsPath` until the load
   * settles. Call it with no `await` after a {@link refusal} that passed.
   */
  reserve(fsPath: string, classNames: readonly string[]): Reservation;
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
   * `fsPath` loaded declaring `classNames`: it owns each one, and gives up any
   * class it owned and no longer declares.
   */
  recordLoad(fsPath: string, classNames: readonly string[]): void;
  /** The refused copies whose package holds `fsPath`, or that are `fsPath`. */
  refusedCopiesHolding(fsPath: string): RefusedCopy[];
  /** Whether `fsPath` is the refused copy `copy` or lies inside its package. */
  copyHolds(copy: RefusedCopy, fsPath: string): boolean;
  /** `fsPath` is gone: drop its refusal, and its claims with their refusals. */
  release(fsPath: string): void;
  /** The OMC session the claims describe was replaced (`:reset`). */
  clear(): void;
  /** Hold off other loaders until the returned release is called, once per hold. */
  hold(): () => void;
  /** Resolves once no hold is outstanding. */
  settled(): Promise<void>;
}

/** The directory a copy of a class sits in, beside its `within` siblings. */
function libraryRoot(fsPath: string): string {
  const dir = path.dirname(fsPath);
  return isPackageFile(fsPath) ? path.dirname(dir) : dir;
}

export function createTopLevelClaims(
  normalizeKey: (filePath: string) => string = defaultNormalizeKey,
): TopLevelClaims {
  // Owners keep the path they loaded under, so a report names the file the
  // way its loader did; comparisons go through `key`.
  const ownerByClass = new Map<string, string>();
  const refusedByKey = new Map<string, RefusedCopy>();
  const reported = new Map<string, string>();
  const key = (p: string): string => normalizeKey(path.resolve(p));

  let heldCount = 0;
  let settledPromise: Promise<void> = Promise.resolve();
  let resolveSettled: (() => void) | undefined;

  const holdsKey = (refused: string, fsPath: string): boolean =>
    refused === fsPath ||
    (isPackageFile(refused) &&
      isInsideDirExclusive(path.dirname(refused), fsPath));

  /** Whether `fsPath`, declaring a class nested in `scope`, extends a refused copy of it. */
  const refusedReach = (
    fsPath: string,
    scope: string,
    owner: string,
  ): boolean => {
    const keptRoot = libraryRoot(key(owner));
    for (const [refused, copy] of refusedByKey) {
      if (copy.className !== scope) continue;
      if (holdsKey(refused, fsPath)) return true;
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
      for (const scope of scopeChain(declared)) {
        const owner = ownerByClass.get(scope);
        if (owner === undefined || key(owner) === fsPath) continue;
        if (scope !== declared && !refusedReach(fsPath, scope, owner)) {
          continue;
        }
        return {
          className: scope,
          keptFileName: owner,
          refusedFileName: rawPath,
        };
      }
    }
    return undefined;
  };

  const refuse = (rawPath: string, className: string): void => {
    refusedByKey.set(key(rawPath), { fileName: rawPath, className });
  };

  const recordLoad = (rawPath: string, classNames: readonly string[]): void => {
    const fsPath = key(rawPath);
    const declared = new Set(classNames);
    for (const [className, owner] of ownerByClass) {
      if (key(owner) === fsPath && !declared.has(className)) {
        ownerByClass.delete(className);
      }
    }
    for (const className of declared) ownerByClass.set(className, rawPath);
    refusedByKey.delete(fsPath);
    reported.delete(fsPath);
  };

  const dropRefusalsOf = (className: string): void => {
    for (const [refused, copy] of refusedByKey) {
      if (isWithinScope(copy.className, className))
        refusedByKey.delete(refused);
    }
    for (const [file, reportedClass] of reported) {
      if (isWithinScope(reportedClass, className)) reported.delete(file);
    }
  };

  return {
    refusal,
    supplies: (fsPath, className) => refusal(fsPath, [className]) === undefined,
    reserve(rawPath, classNames) {
      const reserved = classNames.filter((n) => !ownerByClass.has(n));
      for (const className of reserved) ownerByClass.set(className, rawPath);
      return {
        commit: () => recordLoad(rawPath, classNames),
        cancel() {
          for (const className of reserved) {
            if (ownerByClass.get(className) === rawPath) {
              ownerByClass.delete(className);
            }
          }
        },
      };
    },
    recordRefusal(collision, classNames) {
      if (classNames.includes(collision.className)) {
        refuse(collision.refusedFileName, collision.className);
      }
      const refusedKey = key(collision.refusedFileName);
      if (reported.has(refusedKey)) return false;
      reported.set(refusedKey, collision.className);
      return true;
    },
    refuse,
    recordLoad,
    refusedCopiesHolding(rawPath) {
      const fsPath = key(rawPath);
      return [...refusedByKey]
        .filter(([refused]) => holdsKey(refused, fsPath))
        .map(([, copy]) => copy);
    },
    copyHolds: (copy, fsPath) => holdsKey(key(copy.fileName), key(fsPath)),
    release(rawPath) {
      const fsPath = key(rawPath);
      refusedByKey.delete(fsPath);
      reported.delete(fsPath);
      for (const [className, owner] of ownerByClass) {
        if (key(owner) !== fsPath) continue;
        ownerByClass.delete(className);
        dropRefusalsOf(className);
      }
    },
    clear() {
      ownerByClass.clear();
      refusedByKey.clear();
      reported.clear();
    },
    hold() {
      if (heldCount === 0) {
        settledPromise = new Promise<void>((resolve) => {
          resolveSettled = resolve;
        });
      }
      heldCount++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        heldCount--;
        if (heldCount === 0) resolveSettled?.();
      };
    },
    settled: () => settledPromise,
  };
}
