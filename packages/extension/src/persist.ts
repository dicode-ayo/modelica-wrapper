/**
 * On-disk materialization for OMC-memory-only classes.
 *
 * Pure of any vscode imports so it can be unit-tested with a stub
 * `OmcClient` and a real temp dir. Two consumers:
 *   - `ModelicaSourceProvider.writeFile` (Save on a `modelica-source:` URI)
 *   - `modelica.createClass` (the create command itself)
 *
 * Both call `persistClassUnderWorkspace` to write the file(s), then
 * `linkPersistedClass` to point OMC's symbol-table `fileName` at the new
 * disk location via `setSourceFile`.
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";

import type { OmcClient } from "@dicode/omc-client";

import { pathExists } from "./fs-util.js";

/**
 * True if `s` looks like a real filesystem path we can hand to `fs.writeFile`.
 *
 * OMC's `fileName` field carries one of three things:
 *   - "" for built-in classes,
 *   - the `filename` argument from `loadString` (we pass URIs like
 *     `modelica-source:/Foo.mo` and create flows pass `<runtime:Foo>`),
 *   - an actual on-disk path for classes loaded from `.mo` files.
 * The first two crash `fs.writeFile` with ENOENT; this guard keeps them out.
 *
 * The colon test catches URI schemes (`modelica-source:`, `file:`) while
 * letting Windows drive letters (`C:\…`, single-char prefix) through.
 */
export function isLikelyDiskPath(s: string): boolean {
  if (!s) return false;
  if (s.startsWith("<")) return false;
  const colon = s.indexOf(":");
  if (colon > 1) return false;
  return true;
}

export interface PersistResult {
  /** Path of the leaf class file we wrote. */
  leafPath: string;
  /**
   * Parents that ended up rooted under `workspaceRoot` because OMC didn't
   * already know an on-disk location for them. Caller should
   * `setSourceFile` each so OMC's symbol table tracks the new path.
   */
  newParents: Array<{ typeName: string; pkgFile: string }>;
}

/**
 * Materialize a class as nested directories with `package.mo` files mirroring
 * its dotted qualified name. Parents already on disk (per OMC's `fileName`)
 * are reused — the leaf is placed inside the deepest existing parent's
 * directory. Parents that exist in OMC memory only get fresh
 * `<dir>/package.mo` files under `workspaceRoot`. Existing `package.mo`
 * files on disk are never overwritten.
 */
export async function persistClassUnderWorkspace(
  client: OmcClient,
  workspaceRoot: string,
  qualifiedName: string,
  classText: string,
): Promise<PersistResult> {
  const parts = qualifiedName.split(".");
  const newParents: PersistResult["newParents"] = [];
  let baseDir = workspaceRoot;
  for (let i = 0; i < parts.length - 1; i++) {
    const parentName = parts.slice(0, i + 1).join(".");
    const existingDir = await onDiskParentDir(client, parentName);
    if (existingDir) {
      baseDir = existingDir;
      continue;
    }
    baseDir = path.join(baseDir, parts[i]!);
    await fsp.mkdir(baseDir, { recursive: true });
    const pkgFile = path.join(baseDir, "package.mo");
    if (!(await pathExists(pkgFile))) {
      const within = parts.slice(0, i).join(".");
      const header = within ? `within ${within};\n` : "";
      await fsp.writeFile(
        pkgFile,
        `${header}package ${parts[i]}\nend ${parts[i]};\n`,
        "utf8",
      );
    }
    newParents.push({ typeName: parentName, pkgFile });
  }
  const leafPath = path.join(baseDir, `${parts[parts.length - 1]}.mo`);
  await fsp.mkdir(path.dirname(leafPath), { recursive: true });
  await fsp.writeFile(leafPath, classText, "utf8");
  return { leafPath, newParents };
}

/**
 * Apply `setSourceFile` for the leaf + each newly created parent. Order
 * matters slightly: parents first so OMC sees the package files before the
 * member class. Failures bubble up — the caller decides whether to surface.
 */
export async function linkPersistedClass(
  client: OmcClient,
  typeName: string,
  result: PersistResult,
): Promise<void> {
  for (const p of result.newParents) {
    await client.setSourceFile({ typeName: p.typeName, fileName: p.pkgFile });
  }
  await client.setSourceFile({ typeName, fileName: result.leafPath });
}

async function onDiskParentDir(
  client: OmcClient,
  parentName: string,
): Promise<string | undefined> {
  try {
    const info = await client.getClassInformation({ typeName: parentName });
    if (isLikelyDiskPath(info.fileName)) {
      return path.dirname(info.fileName);
    }
  } catch {
    /* parent not in OMC — caller will create it */
  }
  return undefined;
}

