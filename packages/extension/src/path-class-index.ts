/**
 * Maps a `.mo` file to the fully-qualified classes it declares.
 *
 * Two consumers share one instance: the `.mo` watcher seeds it and keeps it
 * current, and resolves a deleted file's classes through it once the file can
 * no longer be parsed; the OMC mutation router resolves a file-scoped
 * announcement — a save, a diagram reverse sync — to the classes that file
 * declares.
 */

import * as path from "node:path";

/** A file holding classes at or under some scope, paired with just those classes. */
export interface FilesUnderEntry {
  fsPath: string;
  classNames: string[];
}

export interface PathClassIndex {
  get(fsPath: string): string[] | undefined;
  set(fsPath: string, classNames: string[]): void;
  delete(fsPath: string): void;
  /**
   * Every indexed file holding a class at or under `qualifiedName` (itself
   * included), each paired with just the matching classes it declares. A
   * cascade — `deleteClass` on a package, or a reload of it — can touch
   * classes spread across several files, not just the file `qualifiedName`
   * itself lives in.
   */
  filesUnder(qualifiedName: string): FilesUnderEntry[];
}

export function createPathClassIndex(): PathClassIndex {
  const byPath = new Map<string, string[]>();
  const key = (p: string): string => path.resolve(p);
  return {
    get: (p) => byPath.get(key(p)),
    set: (p, names) => void byPath.set(key(p), names),
    delete: (p) => void byPath.delete(key(p)),
    filesUnder(qualifiedName) {
      const prefix = `${qualifiedName}.`;
      const found: FilesUnderEntry[] = [];
      for (const [fsPath, names] of byPath) {
        const matches = names.filter(
          (name) => name === qualifiedName || name.startsWith(prefix),
        );
        if (matches.length > 0) found.push({ fsPath, classNames: matches });
      }
      return found;
    },
  };
}
