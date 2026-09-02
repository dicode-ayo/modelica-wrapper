import * as vscode from "vscode";

import {
  bufferRefusal,
  type StringParseClient,
} from "../single-entity-file.js";
import { omcFilenameForDocument } from "../source-provider.js";

/**
 * Machinery shared by the diagram and documentation edit controllers: both
 * debounce a burst of foreign buffer changes into one reverse sync, skip the
 * ones whose buffer still matches the class, then `loadString` the rest back
 * into OMC before re-fetching their render model. Each controller still owns
 * its own debounce-timer field and the post-load re-fetch step.
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
export interface BufferSyncClient extends StringParseClient {
  loadString(input: {
    data: string;
    filename: string;
    merge: boolean;
  }): Promise<{ success: boolean }>;
  getErrorString(): Promise<{ errorString: string }>;
  getSourceFile(input: { typeName: string }): Promise<{ fileName: string }>;
}

/** The subset of OMC the canonical-source comparison reads. */
export interface ClassSourceClient {
  listFile(input: { typeName: string }): Promise<{ contents: string }>;
}

/**
 * Whether `document` still holds `className` exactly as OMC has it, in which
 * case a reverse sync has nothing to load back. Announcing a mutation reloads
 * the document from `listFile`, and that reload is nobody's self-write, so it
 * reaches a controller as a foreign change — its own edits included. Loading
 * such a buffer back would announce the class again.
 */
export async function bufferMatchesClass(
  client: ClassSourceClient,
  document: vscode.TextDocument,
  className: string,
): Promise<boolean> {
  const { contents } = await client.listFile({ typeName: className });
  return contents === document.getText();
}

export type ReloadResult = { ok: true } | { ok: false; message: string };

/**
 * Reload `document`'s text into OMC, replacing the class. Drains stale
 * diagnostics first so a failure's `getErrorString` attributes only errors
 * this load produced, not ones left over from an earlier call.
 *
 * `expectedClassName` is the class OMC currently holds for this buffer, the
 * one the caller opened its editor on. The rename screen compares what the
 * buffer declares against it, so a caller that passes anything else turns a
 * legitimate edit into a refusal.
 */
export async function reloadBufferIntoOmc(
  client: BufferSyncClient,
  document: vscode.TextDocument,
  expectedClassName: string,
): Promise<ReloadResult> {
  await client.getErrorString();
  const data = document.getText();
  const filename = await omcFilenameForDocument(client, document.uri);
  const refusal = await bufferRefusal(client, {
    data,
    filename,
    expected: expectedClassName,
  });
  if (refusal !== undefined) return { ok: false, message: refusal };
  const { success } = await client.loadString({
    data,
    filename,
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
