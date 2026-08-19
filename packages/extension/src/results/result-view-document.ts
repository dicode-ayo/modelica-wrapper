/**
 * Owns all reads/writes of a single `.omresults` `vscode.TextDocument`.
 *
 * `parseResultViewDoc` backfills a fresh id onto any card that lacks one (a
 * hand-written file, or the Dyad-style `plots` alias). If that backfilled doc
 * is handed to a caller (e.g. posted to the webview) without first being
 * written back to disk, every subsequent re-parse of the on-disk text mints a
 * *different* set of ids — so an id the webview was given can never be found
 * again. `read` closes that gap by persisting a backfill before returning.
 * `mutate` builds on `read` for the same guarantee, and both are serialized
 * through one queue so two edits arriving in the same tick can't read the
 * same stale text and clobber each other.
 */

import { randomUUID } from "node:crypto";

import * as vscode from "vscode";

import type { ResultViewDoc } from "@dicode/omc-client";

import { log } from "../logger.js";
import { parseResultViewDoc, serializeResultViewDoc } from "./result-doc.js";

export class ResultViewDocument {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly document: vscode.TextDocument) {}

  /** Parse the current text, persisting any id backfill before returning. */
  read(): Promise<ResultViewDoc> {
    const result = this.queue.then(() => this.readAndPersist());
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Read the current doc (backfill-persisting, per {@link read}), apply `fn`,
   * and write the result back. */
  mutate(fn: (doc: ResultViewDoc) => ResultViewDoc): Promise<void> {
    const result = this.queue.then(async () => {
      const doc = await this.readAndPersist();
      await this.write(fn(doc));
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async readAndPersist(): Promise<ResultViewDoc> {
    let backfilled = false;
    const doc = parseResultViewDoc(this.document.getText(), () => {
      backfilled = true;
      return randomUUID();
    });
    if (backfilled) {
      await this.write(doc);
    }
    return doc;
  }

  private async write(doc: ResultViewDoc): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      this.document.uri,
      new vscode.Range(0, 0, this.document.lineCount, 0),
      serializeResultViewDoc(doc),
    );
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) {
      log.warn(
        "resultView",
        `applyEdit failed for ${this.document.uri.toString()}`,
      );
    }
  }
}
