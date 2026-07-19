import * as vscode from "vscode";

/**
 * Machinery shared by the diagram and documentation edit controllers: both
 * debounce a burst of foreign buffer changes into one reverse sync, then
 * `loadString` the buffer back into OMC before re-fetching their render
 * model. Only the post-load re-fetch differs between the two, so it stays
 * in each controller.
 */

/** Deferred one-shot timer, injectable so tests drive the debounce directly. */
export interface Scheduler {
  schedule(fn: () => void, delayMs: number): { cancel(): void };
}

export const defaultScheduler: Scheduler = {
  schedule(fn, delayMs) {
    const id = setTimeout(fn, delayMs);
    return { cancel: () => clearTimeout(id) };
  },
};

// Coalesce a burst of foreign changes (holding undo/redo, or typing in the
// text view) into one reverse sync once the buffer settles.
export const REVERSE_SYNC_DEBOUNCE_MS = 150;

/** The subset of OMC a reverse sync drives. */
export interface BufferSyncClient {
  loadString(input: {
    data: string;
    filename: string;
    merge: boolean;
  }): Promise<{ success: boolean }>;
  getErrorString(): Promise<{ errorString: string }>;
}

export type ReloadResult = { ok: true } | { ok: false; message: string };

/**
 * Reload `document`'s text into OMC, replacing the class. Drains stale
 * diagnostics first so a failure's `getErrorString` attributes only errors
 * this load produced, not ones left over from an earlier call.
 */
export async function reloadBufferIntoOmc(
  client: BufferSyncClient,
  document: vscode.TextDocument,
): Promise<ReloadResult> {
  await client.getErrorString();
  const { success } = await client.loadString({
    data: document.getText(),
    filename: document.uri.toString(),
    merge: false,
  });
  if (!success) {
    const { errorString } = await client.getErrorString();
    return {
      ok: false,
      message: `reverse sync rejected by OMC: ${errorString.trim() || "loadString returned success=false"}`,
    };
  }
  return { ok: true };
}

/**
 * Whether the document's backing source is read-only — the source provider
 * reports `Readonly` for MSL / installed-library classes, and a `file:` `.mo`
 * carries the real file's permission. Best-effort: a failed stat is treated as
 * writable so a transient error doesn't lock the editor.
 */
export async function isReadOnlyDocument(
  document: vscode.TextDocument,
): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(document.uri);
    return ((stat.permissions ?? 0) & vscode.FilePermission.Readonly) !== 0;
  } catch {
    return false;
  }
}
