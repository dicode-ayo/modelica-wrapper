import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
  appliedEdits,
  completeApply,
  executedCommands,
  pendingApplies,
  recordedMessages,
  setApplyEditManual,
} from "../../test-support/vscode-mock.js";
import { parseResultViewDoc } from "../results/result-doc.js";
import { ResultViewDocument } from "../results/result-view-document.js";
import {
  RESULT_VIEW_VIEW_TYPE,
  ResultViewEditorProvider,
} from "../results/result-view-provider.js";

import { addResultToView, type AddResultToViewArgs } from "./results.js";

const RUN: AddResultToViewArgs = {
  model: "Lib.DCMotor",
  resultFile: "/ws/DCMotor_res.mat",
};

/** Empty `file:` result view — `ResultViewDocument` reads uri/getText/lineCount. */
function focusedView(): vscode.TextDocument {
  return {
    uri: vscode.Uri.file("/ws/run.omresults"),
    getText: () => "",
    lineCount: 1,
  } as unknown as vscode.TextDocument;
}

/** A `focusedView()`-backed `ResultViewDocument`, standing in for the one the
 *  provider registers as the active view's write queue. */
function activeResultDoc(document = focusedView()): ResultViewDocument {
  return new ResultViewDocument(document, () => {});
}

/** A `focusedView()` whose `getText()` reflects the last edit `landEdit` was
 *  told about — needed so a queued task's own `parse()` sees a prior task's
 *  write once it lands, not the stale text `focusedView`'s fixed closure
 *  would otherwise return. */
function mutableFocusedView(text: string): {
  document: vscode.TextDocument;
  landEdit: () => void;
} {
  let current = text;
  const document = {
    uri: vscode.Uri.file("/ws/run.omresults"),
    getText: () => current,
    lineCount: 1,
  } as unknown as vscode.TextDocument;
  return {
    document,
    landEdit: () => {
      const applied = appliedEdits.at(-1)?.replacements[0]?.text;
      if (applied !== undefined) current = applied;
    },
  };
}

function openWithCalls(): Array<{ command: string; args: unknown[] }> {
  return executedCommands.filter((c) => c.command === "vscode.openWith");
}

describe("addResultToView", () => {
  beforeEach(() => {
    appliedEdits.length = 0;
    executedCommands.length = 0;
    recordedMessages.length = 0;
    pendingApplies.length = 0;
    setApplyEditManual(false);
  });
  afterEach(() => vi.restoreAllMocks());

  it("adds to the focused view and toasts, without opening a scratch view", async () => {
    const view = focusedView();
    vi.spyOn(ResultViewEditorProvider, "getActiveResultDoc").mockReturnValue(
      activeResultDoc(view),
    );

    await addResultToView(RUN);

    expect(appliedEdits).toHaveLength(1);
    expect(appliedEdits[0]?.replacements[0]?.uri.toString()).toBe(
      view.uri.toString(),
    );
    expect(recordedMessages).toContainEqual({
      level: "info",
      message: "Added DCMotor_res to the result view.",
    });
    expect(openWithCalls()).toHaveLength(0);
  });

  it("opens an unsaved scratch view when no result view is focused", async () => {
    vi.spyOn(ResultViewEditorProvider, "getActiveResultDoc").mockReturnValue(
      undefined,
    );

    await addResultToView(RUN);

    const opens = openWithCalls();
    expect(opens).toHaveLength(1);
    const [uri, viewType] = opens[0]?.args ?? [];
    expect((uri as vscode.Uri).scheme).toBe("untitled");
    expect(viewType).toBe(RESULT_VIEW_VIEW_TYPE);
    // Seeded, and no toast — the view appearing is the feedback.
    expect(appliedEdits).toHaveLength(1);
    expect(recordedMessages).toHaveLength(0);
  });

  it("appends the next run to the now-focused scratch instead of a second tab", async () => {
    const active = vi
      .spyOn(ResultViewEditorProvider, "getActiveResultDoc")
      .mockReturnValue(undefined);

    await addResultToView(RUN);
    // Opening the scratch makes it the active view; model that for the next run.
    const scratchUri = openWithCalls()[0]?.args[0] as vscode.Uri;
    active.mockReturnValue(
      activeResultDoc({
        uri: scratchUri,
        getText: () => "",
        lineCount: 1,
      } as unknown as vscode.TextDocument),
    );

    await addResultToView(RUN);

    expect(openWithCalls()).toHaveLength(1); // no second tab opened
    expect(appliedEdits).toHaveLength(2); // both runs added a result
    expect(recordedMessages).toContainEqual({
      level: "info",
      message: "Added DCMotor_res to the result view.",
    });
  });

  it("ignores a run with no result file", async () => {
    const spy = vi
      .spyOn(ResultViewEditorProvider, "getActiveResultDoc")
      .mockReturnValue(undefined);

    await addResultToView({ model: "Lib.DCMotor", resultFile: "" });

    expect(spy).not.toHaveBeenCalled();
    expect(appliedEdits).toHaveLength(0);
    expect(openWithCalls()).toHaveLength(0);
  });

  it("queues behind the focused view's own pending id-backfill write instead of racing it (#489)", async () => {
    setApplyEditManual(true);
    // A card missing its `id` forces `ResultViewDocument.read()` to backfill
    // one and write it back before resolving.
    const noIdDoc = JSON.stringify({
      version: 1,
      results: [
        { id: "r0", label: "run-0", path: "old.mat", source: "simulate" },
      ],
      cards: [{ kind: "plot", title: "Plot 1" }],
    });
    const { document, landEdit } = mutableFocusedView(noIdDoc);
    const resultDoc = activeResultDoc(document);
    vi.spyOn(ResultViewEditorProvider, "getActiveResultDoc").mockReturnValue(
      resultDoc,
    );

    const readPromise = resultDoc.read();
    await vi.waitFor(() => {
      if (pendingApplies.length < 1) throw new Error("no backfill edit yet");
    });

    const addPromise = addResultToView(RUN);
    // The add must queue behind the backfill on `resultDoc`'s own promise
    // chain rather than issue its own `applyEdit` immediately — give an
    // immediate write a tick to happen if it's going to.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pendingApplies).toHaveLength(1);

    landEdit();
    completeApply(0);
    await readPromise;

    await vi.waitFor(() => {
      if (pendingApplies.length < 2) throw new Error("no add-result edit yet");
    });
    landEdit();
    completeApply(1);
    await addPromise;

    expect(appliedEdits).toHaveLength(2);
    const finalDoc = parseResultViewDoc(
      appliedEdits[1]?.replacements[0]?.text ?? "",
    );
    // The backfilled card id from write #1 survived into write #2's output —
    // proving the add read the post-backfill text, not a stale pre-backfill
    // copy raced against it.
    expect(finalDoc.cards[0]?.id).toBeTruthy();
    expect(finalDoc.results.some((r) => r.label === "DCMotor_res")).toBe(true);
  });
});
