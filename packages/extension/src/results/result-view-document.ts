/**
 * Owns the queued reads/writes of a single `.omresults` `vscode.TextDocument`.
 * `add-result.ts`'s `applyAddResults` writes a document directly, outside this
 * queue — but only one with no open editor yet to share a queue with; once an
 * editor is open, its adds go through this class via `mutateAddResults`.
 *
 * `parseResultViewDoc` mints a fresh id for any card that lacks one (a
 * hand-written file, or the Dyad-style `plots` alias), so an id handed out
 * from an unpersisted parse is unfindable on the next parse. `read`
 * therefore writes a backfill back before returning it, and `mutate`
 * inherits that. Both serialize through one queue: two edits arriving in the
 * same tick would otherwise read the same stale text and clobber each other.
 *
 * A failed backfill write is the one write failure `read` can't degrade to a
 * best-effort no-op like every other write does.
 */

import { randomUUID } from "node:crypto";

import * as vscode from "vscode";

import type { ResultViewDoc } from "@dicode/omc-client";

import { errorDetail } from "../error-detail.js";
import { log } from "../logger.js";
import { parseResultViewDoc, serializeResultViewDoc } from "./result-doc.js";

/** The `vscode.TextDocument` surface this class actually reads. */
export interface ResultTextDocument {
  readonly uri: vscode.Uri;
  readonly lineCount: number;
  getText(): string;
}

export class ResultViewDocument {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly document: ResultTextDocument,
    /** Called on any write failure, backfill or `mutate`, so the caller can
     *  surface it to the user; the failure detail itself is only logged
     *  (`write` never throws). */
    private readonly onWriteFailure: () => void,
  ) {}

  get uri(): vscode.Uri {
    return this.document.uri;
  }

  /** Parse the current text, writing any id backfill back before returning.
   *  Rejects if that write fails to persist, instead of handing back a doc
   *  whose freshly-minted ids are unfindable on the next parse; `write` has
   *  already reported the failure through `onWriteFailure`. */
  read(): Promise<ResultViewDoc> {
    return this.enqueue(async () => {
      const { doc, backfilled } = this.parse();
      if (backfilled && !(await this.write(doc))) {
        throw new Error(
          `id backfill did not persist for ${this.document.uri.toString()}`,
        );
      }
      return doc;
    });
  }

  /** Apply `fn` to the current doc and write the result back, persisting any
   *  id backfill the parse produced. Never throws: call sites are
   *  fire-and-forget `void mutate(...)`, so a throwing `fn` logs and drops
   *  the edit. */
  mutate(fn: (doc: ResultViewDoc) => ResultViewDoc): Promise<void> {
    return this.enqueue(async () => {
      try {
        await this.write(fn(this.parse().doc));
      } catch (err) {
        log.warn(
          "resultView",
          `card edit failed for ${this.document.uri.toString()}: ${errorDetail(err)}`,
        );
      }
    });
  }

  /** Chain `task` behind every prior `read`/`mutate` on this document, so two
   *  edits arriving in the same tick can't read the same stale text. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private parse(): { doc: ResultViewDoc; backfilled: boolean } {
    let backfilled = false;
    const doc = parseResultViewDoc(this.document.getText(), () => {
      backfilled = true;
      return randomUUID();
    });
    return { doc, backfilled };
  }

  /** Never throws — a failure is logged and reported via `onWriteFailure`,
   *  not propagated, so a card edit that can't be persisted degrades to a
   *  no-op rather than an unhandled rejection at every `mutate`/`read` call
   *  site. Returns whether the write (or no-op skip) succeeded, so `read`
   *  can tell a failed backfill apart from everything else. */
  private async write(doc: ResultViewDoc): Promise<boolean> {
    try {
      const text = serializeResultViewDoc(doc);
      // A no-op transform (e.g. removeResult with an unknown id) would
      // otherwise still register an undo step and dirty the document.
      if (text === this.document.getText()) return true;
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        this.document.uri,
        new vscode.Range(0, 0, this.document.lineCount, 0),
        text,
      );
      if (await vscode.workspace.applyEdit(edit)) return true;
      log.warn(
        "resultView",
        `applyEdit rejected for ${this.document.uri.toString()}`,
      );
      this.onWriteFailure();
      return false;
    } catch (err) {
      log.warn(
        "resultView",
        `write failed for ${this.document.uri.toString()}: ${errorDetail(err)}`,
      );
      this.onWriteFailure();
      return false;
    }
  }
}
