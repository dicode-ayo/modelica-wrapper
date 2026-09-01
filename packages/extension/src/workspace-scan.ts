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

import { pathExists } from "./fs-util.js";

/**
 * Kept as the reference implementation `deriveEntryPoints` is checked against
 * in `workspace-scan.test.ts`'s differential test — no production code calls
 * this directly.
 */
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

/**
 * The same three discovery rules as {@link discoverEntryPoints}, but derived
 * from an already-known flat list of `.mo` paths (e.g. a recursive
 * `**\/*.mo` glob) instead of walking disk — so a caller that already has
 * such a list (the mo-file-watcher's own reseed) can reuse it rather than
 * paying for a second scan. `allMoFiles` need not be scoped to `roots`; paths
 * outside every root are ignored.
 */
export function deriveEntryPoints(
  allMoFiles: readonly string[],
  roots: readonly string[],
): string[] {
  const files = new Set(allMoFiles.map((f) => path.resolve(f)));
  const out: string[] = [];
  for (const rawRoot of roots) {
    const root = path.resolve(rawRoot);
    const rootPkg = path.join(root, "package.mo");
    if (files.has(rootPkg)) {
      out.push(rootPkg);
      continue;
    }

    const topLevelFiles: string[] = [];
    const topLevelDirs = new Set<string>();
    for (const file of files) {
      const rel = path.relative(root, file);
      if (rel === "" || rel.startsWith(`..${path.sep}`) || rel === "..") {
        continue; // not under this root
      }
      const [first, ...rest] = rel.split(path.sep);
      if (first === undefined || first.startsWith(".")) continue;
      if (rest.length === 0) {
        topLevelFiles.push(file);
      } else {
        topLevelDirs.add(first);
      }
    }
    out.push(...topLevelFiles);
    for (const dir of topLevelDirs) {
      const subPkg = path.join(root, dir, "package.mo");
      if (files.has(subPkg)) out.push(subPkg);
    }
  }
  return out;
}
