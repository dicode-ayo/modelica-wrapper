/**
 * Owns all reads/writes of a single `.omresults` `vscode.TextDocument`.
 *
 * `parseResultViewDoc` mints a fresh id for any card that lacks one (a
 * hand-written file, or the Dyad-style `plots` alias), so an id handed out
 * from an unpersisted parse is unfindable on the next parse. `read`
 * therefore writes a backfill back before returning it, and `mutate`
 * inherits that. Both serialize through one queue: two edits arriving in the
 * same tick would otherwise read the same stale text and clobber each other.
 */

import { randomUUID } from "node:crypto";

import * as vscode from "vscode";

import type { ResultViewDoc } from "@dicode/omc-client";

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

  constructor(private readonly document: ResultTextDocument) {}

  get uri(): vscode.Uri {
    return this.document.uri;
  }

  /** Parse the current text, persisting any id backfill before returning. */
  read(): Promise<ResultViewDoc> {
    const result = this.queue.then(async () => {
      const { doc, backfilled } = this.parse();
      if (backfilled) await this.write(doc);
      return doc;
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Apply `fn` to the current doc and write the result back. The write
   *  persists any id backfill the parse produced. Never throws — same
   *  contract as {@link write}, so a `fn` that throws logs and drops the
   *  edit rather than rejecting every caller's fire-and-forget `mutate()`. */
  mutate(fn: (doc: ResultViewDoc) => ResultViewDoc): Promise<void> {
    const result = this.queue.then(() => {
      let next: ResultViewDoc;
      try {
        next = fn(this.parse().doc);
      } catch (err) {
        log.warn(
          "resultView",
          `card edit failed for ${this.document.uri.toString()}: ${(err as Error).message}`,
        );
        return;
      }
      return this.write(next);
    });
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

  /** Never throws — a failed write is logged, not propagated, so a card edit
   *  that can't be persisted degrades to a no-op rather than an unhandled
   *  rejection at every `mutate`/`read` call site. */
  private async write(doc: ResultViewDoc): Promise<void> {
    let ok: boolean;
    try {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        this.document.uri,
        new vscode.Range(0, 0, this.document.lineCount, 0),
        serializeResultViewDoc(doc),
      );
      ok = await vscode.workspace.applyEdit(edit);
    } catch (err) {
      log.warn(
        "resultView",
        `write failed for ${this.document.uri.toString()}: ${(err as Error).message}`,
      );
      return;
    }
    if (!ok) {
      log.warn(
        "resultView",
        `applyEdit failed for ${this.document.uri.toString()}`,
      );
    }
  }
}
