/**
 * Which file each top-level class in the shared OMC session was loaded from.
 *
 * Every workspace folder loads into one OMC session, so a second file
 * declaring a top-level class another file already supplied would silently
 * replace it.
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

/** A refused copy of a class, and the file its class was kept from. */
export interface RefusedCopy {
  fileName: string;
  className: string;
  keptFileName: string;
}

/** A claim taken before `loadFile`, so a racing load of another copy is refused. */
export interface Reservation {
  /** The load succeeded: record it as {@link TopLevelClaims.recordLoad} does. */
  commit(): void;
  /**
   * The load failed or was skipped: drop the claims this reservation took,
   * and the refusals recorded against them.
   */
  cancel(): void;
}

export interface TopLevelClaims {
  /**
   * The collision that refuses loading `fsPath`, which declares
   * `classNames`, or `undefined` when it may load: another file owns one of
   * its top-level classes, `fsPath` was refused for a class it still
   * declares, it sits inside a refused copy's package, or it is a `within`
   * extension whose nearest library root is a refused copy's.
   */
  refusal(
    fsPath: string,
    classNames: readonly string[],
  ): NameCollision | undefined;
  /** Whether OMC's `className` can be `fsPath`'s: no {@link refusal} for it. */
  supplies(fsPath: string, className: string): boolean;
  /**
   * Claim each unowned top-level class of `classNames` for `fsPath` until the
   * load settles. Call it with no `await` after a {@link refusal} that passed.
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
  /** Record `fsPath` as a copy of `className` refused in favor of `keptFileName`. */
  refuse(fsPath: string, className: string, keptFileName: string): void;
  /**
   * `fsPath` loaded declaring `classNames`: it owns each top-level one, and
   * gives up any it owned and no longer declares.
   */
  recordLoad(fsPath: string, classNames: readonly string[]): void;
  /** The refused copies whose package holds `fsPath`, or that are `fsPath`. */
  refusedCopiesHolding(fsPath: string): RefusedCopy[];
  /** Whether `fsPath` is the refused copy `copy` or lies inside its package. */
  copyHolds(copy: RefusedCopy, fsPath: string): boolean;
  /**
   * `fsPath` is gone: drop its refusal, its claims, and the refusals kept in
   * its favor. Returns the refused copies of a class it owned, which no
   * loaded copy stands for now.
   */
  release(fsPath: string): RefusedCopy[];
  /** The OMC session the claims describe was replaced (`:reset`). */
  clear(): void;
  /** Hold off other loaders until the returned release is called, once per hold. */
  hold(): () => void;
  /** Resolves once no hold is outstanding. */
  settled(): Promise<void>;
}

interface Owner {
  /** As the loader named it, so a report does too. */
  fileName: string;
}

interface Report {
  className: string;
  keptKey: string;
}

function outermost(qualifiedName: string): string | undefined {
  return scopeChain(qualifiedName).at(-1);
}

/** The directory a copy of a class sits in, beside its `within` siblings. */
function libraryRoot(fsPath: string): string {
  const dir = path.dirname(fsPath);
  return isPackageFile(fsPath) ? path.dirname(dir) : dir;
}

export function createTopLevelClaims(
  normalizeKey: (filePath: string) => string = defaultNormalizeKey,
): TopLevelClaims {
  // Each owner is its own object, so a reservation's cancel removes only the
  // entry it created, never one a later load of the same file committed.
  const ownerByClass = new Map<string, Owner>();
  const refusedByKey = new Map<string, RefusedCopy>();
  const reported = new Map<string, Report>();
  const key = (p: string): string => normalizeKey(path.resolve(p));

  let heldCount = 0;
  let settledPromise: Promise<void> = Promise.resolve();
  let resolveSettled: (() => void) | undefined;

  const holdsKey = (refused: string, fsPath: string): boolean =>
    refused === fsPath ||
    (isPackageFile(refused) &&
      isInsideDirExclusive(path.dirname(refused), fsPath));

  /** Whether `fsPath`, declaring a class nested in `className`, extends a refused copy of it. */
  const refusedReach = (
    fsPath: string,
    className: string,
    owner: string,
  ): boolean => {
    const keptRoot = libraryRoot(key(owner));
    for (const [refused, copy] of refusedByKey) {
      if (copy.className !== className) continue;
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
    const own = refusedByKey.get(fsPath);
    for (const declared of classNames) {
      if (own?.className === declared) {
        return {
          className: declared,
          keptFileName: own.keptFileName,
          refusedFileName: rawPath,
        };
      }
      const className = outermost(declared);
      if (className === undefined) continue;
      const owner = ownerByClass.get(className);
      if (owner === undefined || key(owner.fileName) === fsPath) continue;
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

  const refuse = (
    rawPath: string,
    className: string,
    keptFileName: string,
  ): void => {
    refusedByKey.set(key(rawPath), {
      fileName: rawPath,
      className,
      keptFileName,
    });
  };

  const recordLoad = (rawPath: string, classNames: readonly string[]): void => {
    const fsPath = key(rawPath);
    const topLevel = new Set(classNames.filter((n) => outermost(n) === n));
    for (const [className, owner] of ownerByClass) {
      if (key(owner.fileName) === fsPath && !topLevel.has(className)) {
        ownerByClass.delete(className);
      }
    }
    for (const className of topLevel) {
      ownerByClass.set(className, { fileName: rawPath });
    }
    refusedByKey.delete(fsPath);
    reported.delete(fsPath);
  };

  /**
   * Drop the refusals and reports kept in favor of `keptKey`, of `className`
   * and the classes nested in it, or of any class when it is omitted.
   */
  const dropRefusalsFor = (
    keptKey: string,
    className?: string,
  ): RefusedCopy[] => {
    const matches = (kept: string, refusedClass: string): boolean =>
      kept === keptKey &&
      (className === undefined || isWithinScope(refusedClass, className));
    const dropped: RefusedCopy[] = [];
    for (const [refused, copy] of refusedByKey) {
      if (matches(key(copy.keptFileName), copy.className)) {
        refusedByKey.delete(refused);
        dropped.push(copy);
      }
    }
    for (const [file, report] of reported) {
      if (matches(report.keptKey, report.className)) reported.delete(file);
    }
    return dropped;
  };

  return {
    refusal,
    supplies: (fsPath, className) => refusal(fsPath, [className]) === undefined,
    reserve(rawPath, classNames) {
      const reserved: Array<[string, Owner]> = [];
      for (const className of classNames) {
        if (outermost(className) !== className) continue;
        if (ownerByClass.has(className)) continue;
        const owner = { fileName: rawPath };
        ownerByClass.set(className, owner);
        reserved.push([className, owner]);
      }
      return {
        commit: () => recordLoad(rawPath, classNames),
        cancel() {
          for (const [className, owner] of reserved) {
            if (ownerByClass.get(className) !== owner) continue;
            ownerByClass.delete(className);
            dropRefusalsFor(key(rawPath), className);
          }
        },
      };
    },
    recordRefusal(collision, classNames) {
      if (classNames.includes(collision.className)) {
        refuse(
          collision.refusedFileName,
          collision.className,
          collision.keptFileName,
        );
      }
      const refusedKey = key(collision.refusedFileName);
      if (reported.has(refusedKey)) return false;
      reported.set(refusedKey, {
        className: collision.className,
        keptKey: key(collision.keptFileName),
      });
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
      const orphaned: RefusedCopy[] = [];
      for (const [className, owner] of ownerByClass) {
        if (key(owner.fileName) !== fsPath) continue;
        ownerByClass.delete(className);
        for (const copy of dropRefusalsFor(fsPath, className)) {
          if (copy.className === className) orphaned.push(copy);
        }
      }
      // Nested `within` duplicates are refused by path, not by an owner.
      dropRefusalsFor(fsPath);
      return orphaned;
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
