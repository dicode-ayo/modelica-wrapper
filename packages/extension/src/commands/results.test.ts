import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
  appliedEdits,
  executedCommands,
  recordedMessages,
} from "../../test-support/vscode-mock.js";
import {
  RESULT_VIEW_VIEW_TYPE,
  ResultViewEditorProvider,
} from "../results/result-view-provider.js";

import { addResultToView, type AddResultToViewArgs } from "./results.js";

const RUN: AddResultToViewArgs = {
  model: "Lib.DCMotor",
  resultFile: "/ws/DCMotor_res.mat",
};

/** Empty `file:` result view — `applyAddResults` reads uri/getText/lineCount. */
function focusedView(): vscode.TextDocument {
  return {
    uri: vscode.Uri.file("/ws/run.omresults"),
    getText: () => "",
    lineCount: 1,
  } as unknown as vscode.TextDocument;
}

function openWithCalls(): Array<{ command: string; args: unknown[] }> {
  return executedCommands.filter((c) => c.command === "vscode.openWith");
}

describe("addResultToView", () => {
  beforeEach(() => {
    appliedEdits.length = 0;
    executedCommands.length = 0;
    recordedMessages.length = 0;
  });
  afterEach(() => vi.restoreAllMocks());

  it("adds to the focused view and toasts, without opening a scratch view", async () => {
    const view = focusedView();
    vi.spyOn(ResultViewEditorProvider, "getActiveDocument").mockReturnValue(
      view,
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
    vi.spyOn(ResultViewEditorProvider, "getActiveDocument").mockReturnValue(
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
      .spyOn(ResultViewEditorProvider, "getActiveDocument")
      .mockReturnValue(undefined);

    await addResultToView(RUN);
    // Opening the scratch makes it the active view; model that for the next run.
    const scratchUri = openWithCalls()[0]?.args[0] as vscode.Uri;
    active.mockReturnValue({
      uri: scratchUri,
      getText: () => "",
      lineCount: 1,
    } as unknown as vscode.TextDocument);

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
      .spyOn(ResultViewEditorProvider, "getActiveDocument")
      .mockReturnValue(undefined);

    await addResultToView({ model: "Lib.DCMotor", resultFile: "" });

    expect(spy).not.toHaveBeenCalled();
    expect(appliedEdits).toHaveLength(0);
    expect(openWithCalls()).toHaveLength(0);
  });
});
