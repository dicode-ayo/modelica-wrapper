/**
 * The one answer to "may this class be written?".
 *
 * Two independent facts block a write, and both are combined here so no caller
 * has to combine them again:
 *
 *  - **Origin** — a class loaded from `MODELICAPATH` is read-only however its
 *    files are chmod'ed. A package-manager install under
 *    `~/.openmodelica/libraries/` is owned by the user, so a permission check
 *    on its own reads it as editable.
 *  - **Permission** — OMC's `fileReadOnly` for the class's source file, plus,
 *    for a `file:` document, the mode VSCode reports for that file.
 *
 * A refusal carries the sentence the caller shows, so the wording exists once
 * and varies only by the action the caller was about to take.
 *
 * Deriving a verdict fails **open**: a transient OMC error must not lock a user
 * out of a model that is theirs to edit.
 */

import * as vscode from "vscode";

import { errorDetail } from "./error-detail.js";
import { log } from "./logger.js";
import {
  systemLibraryVerdict,
  type SystemLibraryClient,
} from "./system-library.js";

/** The subset of OMC a verdict is derived from. */
export interface WriteVerdictClient extends SystemLibraryClient {
  getClassInformation(input: {
    typeName: string;
  }): Promise<{ fileReadOnly: boolean }>;
}

export type WriteVerdict = { ok: true } | { ok: false; reason: string };

/** What the caller was about to do; selects the verb phrase in a refusal. */
export type WriteAction = "edit" | "save" | "createInside";

const WRITABLE: WriteVerdict = { ok: true };

type Blocker = "systemLibrary" | "readOnlyFile";

const PHRASE: Record<WriteAction, (className: string) => string> = {
  edit: (className) => `edit ${className}`,
  save: (className) => `save ${className}`,
  createInside: (className) => `create a class inside ${className}`,
};

const BECAUSE: Record<Blocker, string> = {
  systemLibrary: "it belongs to a read-only system library",
  readOnlyFile: "its source file is read-only",
};

function refuse(
  className: string,
  action: WriteAction,
  blocker: Blocker,
): WriteVerdict {
  return {
    ok: false,
    reason: `Cannot ${PHRASE[action](className)} — ${BECAUSE[blocker]}.`,
  };
}

/**
 * Verdicts plus the memo they need. One instance is shared across the
 * extension: the origin half has to be captured before the first mutation, and
 * only a shared memo lets one component's capture protect another's later
 * question.
 */
export class WriteVerdicts {
  /**
   * Class origin, memoized only when conclusive. Reflecting an editor buffer
   * back into OMC repoints the class's `fileName` at the buffer URI, after
   * which its `MODELICAPATH` origin is no longer visible — so the first
   * conclusive lookup is the durable one. A class OMC can't resolve yet has no
   * origin to record; caching that as writable would strand a restored
   * system-library editor in edit mode once the class loads.
   *
   * `fileReadOnly` is deliberately not memoized: a `chmod` changes it, and a
   * fresh read is one OMC call.
   */
  private readonly systemLibrary = new Map<string, boolean>();

  /** Whether `className` may be written, and what to say when it may not. */
  async forClass(
    client: WriteVerdictClient,
    className: string,
    action: WriteAction,
  ): Promise<WriteVerdict> {
    try {
      if (await this.fromSystemLibrary(client, className)) {
        return refuse(className, action, "systemLibrary");
      }
      const { fileReadOnly } = await client.getClassInformation({
        typeName: className,
      });
      return fileReadOnly
        ? refuse(className, action, "readOnlyFile")
        : WRITABLE;
    } catch (err) {
      log.debug(
        "writeVerdict",
        `${className}: lookup failed, treating as writable: ${errorDetail(err)}`,
      );
      return WRITABLE;
    }
  }

  /**
   * Whether the class `document` stands for may be written *through that
   * document*.
   *
   * The two schemes ask different things of the file system. A
   * `modelica-source:` document is a listing OMC prints on demand — it has no
   * mode of its own, and the source it stands for is the one
   * {@link forClass} already judged. A `file:` document *is* the source, so its
   * mode can refuse a write the class verdict allows.
   */
  async forDocument(
    client: WriteVerdictClient,
    document: vscode.TextDocument,
    className: string,
    action: WriteAction,
  ): Promise<WriteVerdict> {
    const verdict = await this.forClass(client, className, action);
    if (!verdict.ok || document.uri.scheme !== "file") return verdict;
    try {
      const stat = await vscode.workspace.fs.stat(document.uri);
      const readOnly =
        ((stat.permissions ?? 0) & vscode.FilePermission.Readonly) !== 0;
      return readOnly ? refuse(className, action, "readOnlyFile") : WRITABLE;
    } catch (err) {
      log.debug(
        "writeVerdict",
        `${document.uri.toString()}: stat failed, treating as writable: ${errorDetail(err)}`,
      );
      return WRITABLE;
    }
  }

  /**
   * Record `className`'s origin while the class still points at its on-disk
   * source. Call this on the read that precedes any edit — once a buffer has
   * been reflected into OMC the origin is unrecoverable.
   */
  async capture(client: WriteVerdictClient, className: string): Promise<void> {
    try {
      await this.fromSystemLibrary(client, className);
    } catch (err) {
      log.debug(
        "writeVerdict",
        `${className}: origin capture failed: ${errorDetail(err)}`,
      );
    }
  }

  private async fromSystemLibrary(
    client: WriteVerdictClient,
    className: string,
  ): Promise<boolean> {
    const cached = this.systemLibrary.get(className);
    if (cached !== undefined) return cached;
    const verdict = await systemLibraryVerdict(client, className);
    if (verdict !== undefined) this.systemLibrary.set(className, verdict);
    return verdict ?? false;
  }
}
