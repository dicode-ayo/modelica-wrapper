/**
 * The one fan-out point for "this class's definition changed".
 *
 * Anything derived from a class's source — the sidebar's rendered icon, its
 * restriction badge, the tree-sitter parse tree, the read-only lookup answers
 * — goes stale together, and each cache that holds such a derivation registers
 * a listener here. A producer signals the change once; how many caches care is
 * not its business, and a cache added later needs no producer to change.
 */

import * as vscode from "vscode";

import { errorDetail } from "./error-detail.js";
import { log } from "./logger.js";

/** Drops whatever a cache holds for `className`. Must not throw to be correct. */
export type ClassChangeListener = (className: string) => void;

export class ClassInvalidationRegistry {
  private readonly listeners = new Set<ClassChangeListener>();

  /** Subscribe `listener`; dispose to unsubscribe. */
  register(listener: ClassChangeListener): vscode.Disposable {
    this.listeners.add(listener);
    return new vscode.Disposable(() => {
      this.listeners.delete(listener);
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
}
