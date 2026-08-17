/**
 * The one fan-out point for "this class's definition changed" and for "the
 * whole OMC session was replaced".
 *
 * Anything derived from a class's source — the sidebar's rendered icon, its
 * restriction badge, the tree-sitter parse tree, the read-only lookup answers
 * — goes stale together, and each cache that holds such a derivation registers
 * a listener here. A producer signals the change once; how many caches care is
 * not its business, and a cache added later needs no producer to change.
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

/** Drops whatever a cache holds about the whole session. Must not throw to be correct. */
export type SessionReplacedListener = () => void;

export class ClassInvalidationRegistry {
  private readonly listeners = new Set<ClassChangeListener>();
  private readonly sessionListeners = new Set<SessionReplacedListener>();

  /** Subscribe `listener`; dispose to unsubscribe. */
  register(listener: ClassChangeListener): vscode.Disposable {
    this.listeners.add(listener);
    return new vscode.Disposable(() => {
      this.listeners.delete(listener);
    });
  }

  /** Subscribe `listener` to {@link sessionReplaced}; dispose to unsubscribe. */
  registerSessionReplaced(
    listener: SessionReplacedListener,
  ): vscode.Disposable {
    this.sessionListeners.add(listener);
    return new vscode.Disposable(() => {
      this.sessionListeners.delete(listener);
    });
  }

  /**
   * Signal that `className`'s definition changed. Every listener runs even if
   * an earlier one throws — a cache left stale because a sibling failed is the
   * drift this registry exists to prevent. The listener set is snapshotted so
   * a listener registering or disposing during the fan-out neither joins it
   * nor cuts it short.
   */
  classChanged(className: string): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(className);
      } catch (err) {
        log.warn(
          "invalidation",
          `a listener for ${className} threw: ${errorDetail(err)}`,
        );
      }
    }
  }

  /**
   * Signal that OMC's whole session was replaced (`:reset`): the process is
   * new and its AST starts empty, so every class-scoped fact any listener
   * holds predates a symbol table that no longer exists. Same throw-tolerant,
   * snapshotted fan-out as {@link classChanged}.
   */
  sessionReplaced(): void {
    for (const listener of [...this.sessionListeners]) {
      try {
        listener();
      } catch (err) {
        log.warn(
          "invalidation",
          `a sessionReplaced listener threw: ${errorDetail(err)}`,
        );
      }
    }
  }
}

/**
 * A promise chain serializing tasks appended via {@link enqueue}, so each
 * starts only after every previously queued one has settled. {@link current}
 * is the tail of the chain, for a caller that must wait on whatever is
 * queued as of now, not just what was queued when it first read the chain.
 */
export class SessionQueue {
  private tail: Promise<void>;

  constructor(initial: Promise<void> = Promise.resolve()) {
    this.tail = initial;
  }

  enqueue(task: () => Promise<void>): void {
    this.tail = this.tail.then(task);
  }

  get current(): Promise<void> {
    return this.tail;
  }
}
