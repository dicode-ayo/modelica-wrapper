/** Filesystem helpers shared across the extension. No `vscode` import. */

import * as fsp from "node:fs/promises";

/** `true` iff `p` is accessible. Any `fsp.access` rejection collapses to `false`. */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}
