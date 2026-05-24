/**
 * Host-side flows for adding a `.mat` result to a `*.omresults` view document.
 *
 * Two of the three add paths are triggered from a result view itself (the
 * webview's `addResult` message) and so already know their target document:
 * {@link importResults} (a file dialog) and {@link addCachedResult} (a
 * quick-pick over the `.modelica` cache). The third — auto-add on Simulate —
 * reuses {@link buildResultRef} and {@link applyAddResults} from the command
 * side (#86, Stage B). Path resolution lives here too so both sides agree.
 */

import { randomUUID } from "node:crypto";
import * as path from "node:path";

import * as vscode from "vscode";

import type { ResultRef, ResultSource } from "@modelica-wrapper/omc-client";

import { workspaceCacheUri } from "../workspace-cache.js";
import { addResult, parseResultViewDoc, serializeResultViewDoc } from "./result-doc.js";

const MAT_EXTENSION = ".mat";

/** Resolve a stored result path: relative paths hang off the document's folder. */
export function resolveResultPath(documentUri: vscode.Uri, stored: string): string {
  return path.isAbsolute(stored)
    ? stored
    : path.join(path.dirname(documentUri.fsPath), stored);
}

/** Store a `.mat` path relative to the document when it sits under the doc's
 * folder, else absolute. The inverse of {@link resolveResultPath}. */
export function storeResultPath(documentUri: vscode.Uri, absMatPath: string): string {
  const rel = path.relative(path.dirname(documentUri.fsPath), absMatPath);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : absMatPath;
}

/** Default label for a `.mat`: its file stem (`DCMotor_res.mat` → `DCMotor_res`). */
function labelFromPath(absMatPath: string): string {
  return path.basename(absMatPath, path.extname(absMatPath));
}

/** Build a {@link ResultRef} for a freshly added `.mat`, minting its id. */
export function buildResultRef(
  documentUri: vscode.Uri,
  absMatPath: string,
  source: ResultSource,
  extras: { model?: string; parameters?: Record<string, string> } = {},
): ResultRef {
  return {
    id: randomUUID(),
    label: labelFromPath(absMatPath),
    path: storeResultPath(documentUri, absMatPath),
    source,
    createdAt: new Date().toISOString(),
    ...(extras.model !== undefined ? { model: extras.model } : {}),
    ...(extras.parameters !== undefined ? { parameters: extras.parameters } : {}),
  };
}

/**
 * Add results to a view document in one `WorkspaceEdit` (a single undo step),
 * skipping any whose resolved path is already in the view. Returns how many were
 * actually added so callers can report duplicates.
 */
export async function applyAddResults(
  document: vscode.TextDocument,
  refs: readonly ResultRef[],
): Promise<number> {
  let doc = parseResultViewDoc(document.getText());
  const seen = new Set(doc.results.map((r) => resolveResultPath(document.uri, r.path)));
  let added = 0;
  for (const ref of refs) {
    const abs = resolveResultPath(document.uri, ref.path);
    if (seen.has(abs)) {
      continue;
    }
    seen.add(abs);
    doc = addResult(doc, ref);
    added++;
  }
  if (added === 0) {
    return 0;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(0, 0, document.lineCount, 0),
    serializeResultViewDoc(doc),
  );
  await vscode.workspace.applyEdit(edit);
  return added;
}

/** Tell the user when some picked results were already in the view. */
function notifyDuplicates(requested: number, added: number): void {
  const duplicates = requested - added;
  if (duplicates <= 0) {
    return;
  }
  void vscode.window.showInformationMessage(
    duplicates === 1
      ? "That result is already in this view."
      : `${duplicates} results were already in this view.`,
  );
}

/** File-dialog path (`via: "import"`): pick one or more `.mat` files to add. */
export async function importResults(document: vscode.TextDocument): Promise<void> {
  const picks = await vscode.window.showOpenDialog({
    canSelectMany: true,
    openLabel: "Add to results view",
    filters: { "Simulation results": ["mat"] },
  });
  if (!picks || picks.length === 0) {
    return;
  }
  const refs = picks.map((uri) => buildResultRef(document.uri, uri.fsPath, "import"));
  notifyDuplicates(refs.length, await applyAddResults(document, refs));
}

interface CachedPick extends vscode.QuickPickItem {
  fsPath: string;
  mtime: number;
}

/** Cache path (`via: "cache"`): quick-pick over `.mat` files in `.modelica`. */
export async function addCachedResult(document: vscode.TextDocument): Promise<void> {
  const cacheDir = workspaceCacheUri();
  if (!cacheDir) {
    void vscode.window.showWarningMessage(
      "Open a workspace folder to add cached results.",
    );
    return;
  }
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(cacheDir);
  } catch {
    void vscode.window.showInformationMessage("No cached results yet.");
    return;
  }
  const mats = entries.filter(
    ([name, type]) =>
      type === vscode.FileType.File && name.toLowerCase().endsWith(MAT_EXTENSION),
  );
  if (mats.length === 0) {
    void vscode.window.showInformationMessage("No cached results yet.");
    return;
  }
  const items: CachedPick[] = await Promise.all(
    mats.map(async ([name]) => {
      const uri = vscode.Uri.joinPath(cacheDir, name);
      const { mtime } = await vscode.workspace.fs.stat(uri);
      return {
        label: name,
        description: new Date(mtime).toLocaleString(),
        fsPath: uri.fsPath,
        mtime,
      };
    }),
  );
  // Newest first — the result you just simulated is usually the one you want.
  items.sort((a, b) => b.mtime - a.mtime);
  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: "Add cached result(s) to this view",
  });
  if (!picked || picked.length === 0) {
    return;
  }
  const refs = picked.map((p) => buildResultRef(document.uri, p.fsPath, "cache"));
  notifyDuplicates(refs.length, await applyAddResults(document, refs));
}
