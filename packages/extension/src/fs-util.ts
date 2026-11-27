/** Filesystem helpers shared across the extension. No `vscode` import. */

import * as path from "node:path";

export { pathExists } from "@dicode/omc-client";

/** Case-folds on case-insensitive hosts (win32/darwin); identity elsewhere. */
export const defaultNormalizeKey: (filePath: string) => string =
  process.platform === "win32" || process.platform === "darwin"
    ? (p) => p.toLowerCase()
    : (p) => p;

function relativeInside(dir: string, target: string): string | undefined {
  const rel = path.relative(dir, target);
  const outside =
    rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  return outside ? undefined : rel;
}

/** True when `target` is `dir` itself or nested beneath it. */
export function isInsideDirInclusive(dir: string, target: string): boolean {
  return relativeInside(dir, target) !== undefined;
}

/** True when `target` is nested beneath `dir`, `dir` itself excluded. */
export function isInsideDirExclusive(dir: string, target: string): boolean {
  const rel = relativeInside(dir, target);
  return rel !== undefined && rel !== "";
}

export function isPackageFile(fsPath: string): boolean {
  return path.basename(fsPath) === "package.mo";
}
