/**
 * The one fan-out point for "this class's definition changed", for "something
 * changed that no class name describes", and for "the whole OMC session was
 * replaced".
 *
 * Anything derived from a class's source — the sidebar's rendered icon, its
 * restriction badge, the tree-sitter parse tree, the read-only lookup answers
 * — goes stale together, and each cache that holds such a derivation registers
 * a listener here. A producer signals the change once; how many caches care is
 * not its business, and a cache added later needs no producer to change.
 *
 * `allClassesChanged` is the sibling signal for a change whose class cannot be
 * named: a REPL `renameClass`, an `installPackage`, a command that did not
 * parse. The AST is still there, but which part of it moved is unknown, so a
 * cache drops everything it holds rather than one entry.
 *
 * `sessionReplaced` is the coarser sibling signal: the REPL's `:reset` closes
 * OMC and spawns a fresh process with an empty AST, which invalidates every
 * class at once rather than one at a time. A cache that only tracks
 * per-class staleness (a path→class index, a "this file is loaded" flag)
 * needs this to know the symbol table underneath it is gone, not just one
 * entry in it.
 */

import * as vscode from "vscode";

import { errorDetail } from "./error-detail.js";
import { log } from "./logger.js";

/** Drops whatever a cache holds for `className`. Must not throw to be correct. */
export type ClassChangeListener = (className: string) => void;

/** Drops everything a cache holds. Must not throw to be correct. */
export type AllClassesChangedListener = () => void;

/** Drops whatever a cache holds about the whole session. Must not throw to be correct. */
export type SessionReplacedListener = () => void;

export class ClassInvalidationRegistry {
  private readonly listeners = new Set<ClassChangeListener>();
  private readonly allClassesListeners = new Set<AllClassesChangedListener>();
  private readonly sessionListeners = new Set<SessionReplacedListener>();

  /** Subscribe `listener`; dispose to unsubscribe. */
  register(listener: ClassChangeListener): vscode.Disposable {
    return subscribe(this.listeners, listener);
  }

  /** Subscribe `listener` to {@link allClassesChanged}; dispose to unsubscribe. */
  registerAllClassesChanged(
    listener: AllClassesChangedListener,
  ): vscode.Disposable {
    return subscribe(this.allClassesListeners, listener);
  }

  /** Subscribe `listener` to {@link sessionReplaced}; dispose to unsubscribe. */
  registerSessionReplaced(
    listener: SessionReplacedListener,
  ): vscode.Disposable {
    return subscribe(this.sessionListeners, listener);
  }

  /** Signal that `className`'s definition changed. */
  classChanged(className: string): void {
    fanOut(this.listeners, (l) => l(className), `for ${className}`);
  }

  /**
   * Signal that something changed in OMC that no class name describes — a
   * `renameClass`, an `installPackage`, a command that did not parse. The
   * symbol table is still there; which part of it moved is unknown.
   *
   * Nothing that re-loads the workspace may listen here: a `:load` announcing
   * this would trigger a sweep that triggers a load. That is what keeps this
   * separate from {@link sessionReplaced}.
   */
  allClassesChanged(): void {
    fanOut(this.allClassesListeners, (l) => l(), "allClassesChanged");
  }

  /**
   * Signal that OMC's whole session was replaced (`:reset`): the process is
   * new and its AST starts empty, so every class-scoped fact any listener
   * holds predates a symbol table that no longer exists.
   */
  sessionReplaced(): void {
    fanOut(this.sessionListeners, (l) => l(), "sessionReplaced");
  }
}

function subscribe<L>(listeners: Set<L>, listener: L): vscode.Disposable {
  listeners.add(listener);
  return new vscode.Disposable(() => {
    listeners.delete(listener);
  });
}

/**
 * Every listener runs even if an earlier one throws — a cache left stale
 * because a sibling failed is the drift this registry exists to prevent. The
 * set is snapshotted so a listener registering or disposing during the fan-out
 * neither joins it nor cuts it short.
 */
function fanOut<L>(
  listeners: Set<L>,
  invoke: (listener: L) => void,
  signal: string,
): void {
  for (const listener of [...listeners]) {
    try {
      invoke(listener);
    } catch (err) {
      log.warn(
        "invalidation",
        `a listener ${signal} threw: ${errorDetail(err)}`,
      );
    }
  }
}
