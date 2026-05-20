/**
 * A bounded LIFO stack of OMC source snapshots backing the diagram-local
 * undo (issue #29, deferred half).
 *
 * Diagram edits (move / delete / connect, parameter writes) go straight to
 * OMC — they never flow through a VSCode `TextDocument`, so native Ctrl-Z
 * can't see them. Instead, before each mutating diagram op we push a
 * `captureSnapshot` of the host class's source onto this stack; the Undo
 * action pops the most-recent snapshot and replays it via `restoreSnapshot`.
 *
 * The stack is deliberately tiny and pure (no OMC, no VSCode) so the
 * push / pop / cap / empty-pop behaviour is unit-testable in isolation. The
 * snapshot capture/restore I/O lives in `omc-snapshot.ts`; the wiring that
 * decides *when* to push lives in `open-diagram.ts`.
 *
 * Memory is bounded by `capacity`: pushing past it drops the OLDEST entry
 * (a snapshot is the whole class source, so an unbounded stack on a large
 * model could grow without limit over a long editing session).
 */

import type { OmcSnapshot } from "./omc-snapshot.js";

/** Default depth — 50 undo steps is plenty for a diagram editing session
 *  while keeping the worst-case memory (50 × class source) bounded. */
export const DEFAULT_SNAPSHOT_STACK_CAPACITY = 50;

export class SnapshotStack {
  private readonly entries: OmcSnapshot[] = [];

  constructor(
    private readonly capacity: number = DEFAULT_SNAPSHOT_STACK_CAPACITY,
  ) {
    if (capacity < 1) {
      throw new Error(
        `SnapshotStack capacity must be >= 1 (got ${capacity})`,
      );
    }
  }

  /** Number of snapshots currently held. */
  get size(): number {
    return this.entries.length;
  }

  /** True when there's nothing to undo. */
  get isEmpty(): boolean {
    return this.entries.length === 0;
  }

  /**
   * Push a snapshot onto the stack. Best-effort: a `undefined` snapshot
   * (capture skipped — built-in class, empty listFile, …) is ignored so the
   * caller can pass `captureSnapshot(...)`'s result straight through without
   * branching. When at capacity, the oldest entry is dropped.
   */
  push(snapshot: OmcSnapshot | undefined): void {
    if (snapshot === undefined) return;
    this.entries.push(snapshot);
    if (this.entries.length > this.capacity) {
      this.entries.shift();
    }
  }

  /**
   * Pop the most-recent snapshot, or `undefined` when the stack is empty.
   * The caller restores it via `restoreSnapshot` and surfaces an
   * empty-stack message to the user.
   */
  pop(): OmcSnapshot | undefined {
    return this.entries.pop();
  }

  /** Inspect the most-recent snapshot without removing it. */
  peek(): OmcSnapshot | undefined {
    return this.entries[this.entries.length - 1];
  }

  /** Drop every snapshot — used when the underlying class changes identity. */
  clear(): void {
    this.entries.length = 0;
  }
}
