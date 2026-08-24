/**
 * Host-side flows for adding a `.mat` result to a `*.omresults` view document.
 *
 * All three add paths — {@link importResults} (a file dialog),
 * {@link addCachedResult} (a quick-pick over the `.modelica` cache), and the
 * command side's Simulate auto-add — already have or create the target
 * document's `ResultViewDocument` and write through {@link mutateAddResults},
 * reusing {@link buildResultRef} for the `ResultRef` itself. Path resolution
 * lives here too so all three agree.
 */

import { randomUUID } from "node:crypto";
import * as path from "node:path";

import * as vscode from "vscode";

import type {
  ResultRef,
  ResultSource,
  ResultViewDoc,
} from "@dicode/omc-client";

import { workspaceCacheUri } from "../workspace-cache.js";
import { addResult } from "./result-doc.js";
import type { ResultViewDocument } from "./result-view-document.js";

const MAT_EXTENSION = ".mat";

/** Resolve a stored result path: relative paths hang off the document's folder. */
export function resolveResultPath(
  documentUri: vscode.Uri,
  stored: string,
): string {
  return path.isAbsolute(stored)
    ? stored
    : path.join(path.dirname(documentUri.fsPath), stored);
}

/** Store a `.mat` path relative to the document when it sits under the doc's
 * folder, else absolute. The inverse of {@link resolveResultPath}. */
export function storeResultPath(
  documentUri: vscode.Uri,
  absMatPath: string,
): string {
  // An unsaved (untitled/virtual) view has no folder to relativize against;
  // store absolute so its paths survive a later Save-As to any location.
  if (documentUri.scheme !== "file") {
    return absMatPath;
  }
  const rel = path.relative(path.dirname(documentUri.fsPath), absMatPath);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
    ? rel
    : absMatPath;
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
    ...(extras.parameters !== undefined
      ? { parameters: extras.parameters }
      : {}),
  };
}

/** Fold `refs` into `doc`, skipping any whose resolved path is already in the
 *  view. Returns how many were actually added so callers can report duplicates. */
function addResultsToDoc(
  doc: ResultViewDoc,
  documentUri: vscode.Uri,
  refs: readonly ResultRef[],
): { doc: ResultViewDoc; added: number } {
  const seen = new Set(
    doc.results.map((r) => resolveResultPath(documentUri, r.path)),
  );
  let next = doc;
  let added = 0;
  for (const ref of refs) {
    const abs = resolveResultPath(documentUri, ref.path);
    if (seen.has(abs)) {
      continue;
    }
    seen.add(abs);
    next = addResult(next, ref);
    added++;
  }
  return { doc: next, added };
}

/**
 * Add results to a document that already has an open `ResultViewDocument` —
 * the editor's own queue, and the queue the Simulate auto-add path
 * (`commands/results.ts`) shares with it via
 * `ResultViewEditorProvider.getActiveResultDoc()`. Serializing through
 * `.mutate()` here is what stops an add racing a concurrent id-backfill write
 * or card edit on the same document.
 *
 * `persisted` mirrors `mutate()`'s own return: `false` for a write that
 * didn't land, `resultDoc`'s `onWriteFailure` having already reported why.
 *
 * An add that adds nothing (every ref already in the view) still goes through
 * `mutate()` rather than short-circuiting here, so a parse that needed an id
 * backfill still gets it persisted — `mutate()`'s own no-op check is what
 * skips the actual `WorkspaceEdit` once that backfill is already in the text.
 */
export async function mutateAddResults(
  resultDoc: ResultViewDocument,
  refs: readonly ResultRef[],
): Promise<{ added: number; persisted: boolean }> {
  let added = 0;
  const persisted = await resultDoc.mutate((doc) => {
    const result = addResultsToDoc(doc, resultDoc.uri, refs);
    added = result.added;
    return result.doc;
  });
  return { added, persisted };
}

/**
 * Tell the user when some picked results were already in the view. `label`
 * names the single duplicate when the caller already knows which one — the
 * Simulate auto-add path, which only ever adds one ref at a time and whose
 * user is on the diagram rather than the view, so naming the run (rather
 * than a bare count) is what makes the toast legible there.
 */
export function notifyDuplicates(
  requested: number,
  added: number,
  label?: string,
): void {
  const duplicates = requested - added;
  if (duplicates <= 0) {
    return;
  }
  void vscode.window.showInformationMessage(
    label !== undefined
      ? `${label} is already in the result view.`
      : duplicates === 1
        ? "That result is already in this view."
        : `${duplicates} results were already in this view.`,
  );
}

/** File-dialog path (`via: "import"`): pick one or more `.mat` files to add. */
export async function importResults(
  resultDoc: ResultViewDocument,
): Promise<void> {
  const picks = await vscode.window.showOpenDialog({
    canSelectMany: true,
    openLabel: "Add to results view",
    filters: { "Simulation results": ["mat"] },
  });
  if (!picks || picks.length === 0) {
    return;
  }
  const refs = picks.map((uri) =>
    buildResultRef(resultDoc.uri, uri.fsPath, "import"),
  );
  const result = await mutateAddResults(resultDoc, refs);
  // A failed write already surfaced through `onWriteFailure` — reporting
  // duplicates on top of that would be a second, contradictory message.
  if (result.persisted) {
    notifyDuplicates(refs.length, result.added);
  }
}

interface CachedPick extends vscode.QuickPickItem {
  fsPath: string;
  mtime: number;
}

/** Cache path (`via: "cache"`): quick-pick over `.mat` files in `.modelica`. */
export async function addCachedResult(
  resultDoc: ResultViewDocument,
): Promise<void> {
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
      type === vscode.FileType.File &&
      name.toLowerCase().endsWith(MAT_EXTENSION),
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
  const refs = picked.map((p) =>
    buildResultRef(resultDoc.uri, p.fsPath, "cache"),
  );
  const result = await mutateAddResults(resultDoc, refs);
  if (result.persisted) {
    notifyDuplicates(refs.length, result.added);
  }
}
