/**
 * Top-level scan for Modelica entry points in a set of workspace folders.
 * Pure of vscode imports so it can be unit-tested with a temp directory.
 *
 * Discovery rules per folder, in order:
 *   1. `<root>/package.mo` — the workspace IS a package; this single file is
 *      the only entry point (OMC's loadFile treats it like loadModel).
 *   2. Otherwise, every top-level `<root>/*.mo` standalone file.
 *   3. Every top-level `<root>/<dir>/package.mo` (subdirectory packages).
 *
 * Hidden entries (starting with `.`) are skipped — `.git`, `.vscode`, etc.
 * Recursion stops at the package boundary on purpose: loading `package.mo`
 * pulls the whole subtree, so we don't need to walk into it.
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";

export async function discoverEntryPoints(roots: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const root of roots) {
    const rootPkg = path.join(root, "package.mo");
    if (await pathExists(rootPkg)) {
      out.push(rootPkg);
      continue;
    }
    let entries;
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const p = path.join(root, entry.name);
      if (entry.isFile() && entry.name.endsWith(".mo")) {
        out.push(p);
      } else if (entry.isDirectory()) {
        const subPkg = path.join(p, "package.mo");
        if (await pathExists(subPkg)) out.push(subPkg);
      }
    }
  }
  return out;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}
