import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { setApplyEditResult } from "../../test-support/vscode-mock.js";

import {
  ResultViewDocument,
  type ResultTextDocument,
} from "./result-view-document.js";

vi.mock("../logger.js", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  },
}));

function emptyDoc(): ResultTextDocument {
  return {
    uri: vscode.Uri.file("/ws/run.omresults"),
    lineCount: 1,
    getText: () => JSON.stringify({ version: 1, results: [], cards: [] }),
  };
}

describe("ResultViewDocument.mutate", () => {
  beforeEach(() => {
    setApplyEditResult(true);
  });

  it("reports the failure through onWriteFailure when the transform throws", async () => {
    const onWriteFailure = vi.fn();
    const doc = new ResultViewDocument(emptyDoc(), onWriteFailure);

    const persisted = await doc.mutate(() => {
      throw new Error("boom");
    });

    expect(persisted).toBe(false);
    expect(onWriteFailure).toHaveBeenCalledTimes(1);
  });

  it("reports the failure through onWriteFailure when applyEdit rejects", async () => {
    const onWriteFailure = vi.fn();
    const doc = new ResultViewDocument(emptyDoc(), onWriteFailure);
    setApplyEditResult(false);

    const persisted = await doc.mutate((current) => ({
      ...current,
      results: [
        {
          id: "r1",
          label: "run-1",
          path: "run-1.mat",
          source: "simulate",
          createdAt: new Date(0).toISOString(),
        },
      ],
    }));

    expect(persisted).toBe(false);
    expect(onWriteFailure).toHaveBeenCalledTimes(1);
  });
});
