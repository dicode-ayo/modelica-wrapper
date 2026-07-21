/**
 * Records `.mo` disk writes the extension makes itself so a workspace file
 * watcher can tell them apart from genuine external edits.
 *
 * A filesystem watcher fires *after* `fs.writeFile` resolves, so a synchronous
 * ref-count — the trick the shadow buffer uses for in-editor edits — can't gate
 * it: the count is back to zero by the time the OS delivers the event. Each
 * self-write instead parks the exact text under the file's path, and a watcher
 * event `claim`s it by comparing the text now on disk, which is timing-independent.
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";

export interface SelfWriteGuard {
  /** Park `text` as the content we are about to write to `fsPath`. */
  record(fsPath: string, text: string): void;
  /**
   * True when `fsPath` has a parked self-write whose text equals `diskText` —
   * the event is ours and should be skipped. The entry stays parked while the
   * disk still matches, so a single write surfaced as coalesced create+change
   * events stays claimed; it's dropped only once the disk text diverges, which
   * marks a genuine external edit.
   */
  claim(fsPath: string, diskText: string): boolean;
  /** Park a self-write then perform it, so no watcher event can slip in first. */
  write(fsPath: string, text: string): Promise<void>;
}

export function createSelfWriteGuard(): SelfWriteGuard {
  const pending = new Map<string, string>();
  const key = (p: string): string => path.resolve(p);
  const guard: SelfWriteGuard = {
    record(fsPath, text) {
      pending.set(key(fsPath), text);
    },
    claim(fsPath, diskText) {
      const k = key(fsPath);
      const expected = pending.get(k);
      if (expected === undefined) return false;
      if (expected === diskText) return true;
      pending.delete(k);
      return false;
    },
    async write(fsPath, text) {
      guard.record(fsPath, text);
      await fsp.writeFile(fsPath, text, "utf8");
    },
  };
  return guard;
}
