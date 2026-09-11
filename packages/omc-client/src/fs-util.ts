/** Filesystem helpers. No OMC, no editor. */

import { access } from "node:fs/promises";

/** `true` iff `p` is accessible. Any `fsp.access` rejection collapses to `false`. */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
