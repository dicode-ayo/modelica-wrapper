/**
 * In-memory line-editor history for the REPL pseudo-terminal.
 *
 * Lives in its own module so it can be unit-tested without spinning up the
 * VSCode `Pseudoterminal` surface. The shape mirrors what a classic shell
 * exposes:
 *
 *   - `push(line)` commits a completed input. Consecutive duplicates collapse.
 *   - `up(currentDraft)` / `down(currentDraft)` walk through previous entries
 *     and restore the unsubmitted draft when the user returns past the
 *     most-recent entry.
 *   - Bounded at MAX entries to keep memory predictable for a long session.
 *
 * The contract for the draft is intentional: callers pass the live editor
 * buffer on each arrow-key, and the helper returns the line that should
 * replace it. The first up-arrow stashes the supplied draft; subsequent
 * arrow keys ignore the draft until the user descends back to the "end"
 * sentinel.
 */

export const MAX_HISTORY = 500;

export class ReplHistory {
  private entries: string[] = [];
  /**
   * Pointer into `entries`. `null` means "in-progress draft" (no walk in
   * progress); otherwise it's the index of the entry currently being
   * shown to the user.
   */
  private index: number | null = null;
  /** Snapshot of the current in-progress line when the walk started. */
  private savedDraft = "";

  /** Append a completed line. Empty lines and exact-consecutive dupes drop. */
  push(line: string): void {
    if (line.length === 0) return;
    if (this.entries[this.entries.length - 1] === line) {
      this.resetWalk();
      return;
    }
    this.entries.push(line);
    if (this.entries.length > MAX_HISTORY) {
      // Drop the oldest. We never look past `entries.length` so no other
      // bookkeeping is required.
      this.entries.shift();
    }
    this.resetWalk();
  }

  /** Move one step into the past. Returns the line to display. */
  up(currentDraft: string): string {
    if (this.entries.length === 0) return currentDraft;
    if (this.index === null) {
      this.savedDraft = currentDraft;
      this.index = this.entries.length - 1;
    } else if (this.index > 0) {
      this.index -= 1;
    }
    return this.entries[this.index] ?? currentDraft;
  }

  /** Move one step forward. At the bottom, restore the saved draft. */
  down(currentDraft: string): string {
    if (this.index === null) {
      // Not walking — down has no effect; whatever the caller has stays.
      return currentDraft;
    }
    if (this.index < this.entries.length - 1) {
      this.index += 1;
      return this.entries[this.index] ?? currentDraft;
    }
    // Past the most-recent entry → restore the saved draft.
    const draft = this.savedDraft;
    this.resetWalk();
    return draft;
  }

  /** True while the user is browsing past entries. */
  isWalking(): boolean {
    return this.index !== null;
  }

  /** Total committed entries (for tests). */
  size(): number {
    return this.entries.length;
  }

  private resetWalk(): void {
    this.index = null;
    this.savedDraft = "";
  }
}
