/**
 * `reloadBufferIntoOmc` pins the stale-diagnostics drain running before the
 * load, and a rejected load's message coming from the *second*
 * `getErrorString` call, not the first.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { setStatReadonly } from "../../test-support/vscode-mock.js";

import {
  defaultScheduler,
  isReadOnlyDocument,
  reloadBufferIntoOmc,
  type BufferSyncClient,
} from "./buffer-sync.js";

function docFor(uri: vscode.Uri, text = ""): vscode.TextDocument {
  return {
    uri,
    getText: () => text,
  } as unknown as vscode.TextDocument;
}

const DOC_URI = vscode.Uri.parse("modelica-source:/Pkg.Model.mo");

beforeEach(() => {
  setStatReadonly(false);
});

describe("reloadBufferIntoOmc", () => {
  it("drains stale diagnostics before loading the buffer's text", async () => {
    const calls: string[] = [];
    const client: BufferSyncClient = {
      getErrorString: vi.fn(async () => {
        calls.push("getErrorString");
        return { errorString: "" };
      }),
      loadString: vi.fn(async (input) => {
        calls.push("loadString");
        expect(input).toEqual({
          data: "model Model end Model;",
          filename: DOC_URI.toString(),
          merge: false,
        });
        return { success: true };
      }),
    };

    const result = await reloadBufferIntoOmc(
      client,
      docFor(DOC_URI, "model Model end Model;"),
    );

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(["getErrorString", "loadString"]);
  });

  it("reports the post-load error, not the drained pre-load one", async () => {
    const errorStrings = [
      "stale error from a prior edit",
      "the real rejection",
    ];
    const client: BufferSyncClient = {
      getErrorString: vi.fn(async () => ({
        errorString: errorStrings.shift() ?? "",
      })),
      loadString: vi.fn(async () => ({ success: false })),
    };

    const result = await reloadBufferIntoOmc(client, docFor(DOC_URI));

    expect(result).toEqual({
      ok: false,
      message: "reverse sync rejected by OMC: the real rejection",
    });
  });

  it("falls back to a generic message when OMC reports no error text", async () => {
    const client: BufferSyncClient = {
      getErrorString: vi.fn(async () => ({ errorString: "" })),
      loadString: vi.fn(async () => ({ success: false })),
    };

    const result = await reloadBufferIntoOmc(client, docFor(DOC_URI));

    expect(result).toEqual({
      ok: false,
      message:
        "reverse sync rejected by OMC: loadString returned success=false",
    });
  });
});

describe("reloadBufferIntoOmc — source-file resolution", () => {
  it("loads under the class's real source file so an inline member stays put", async () => {
    let loadedFilename: string | undefined;
    const client: BufferSyncClient = {
      getErrorString: vi.fn(async () => ({ errorString: "" })),
      getSourceFile: vi.fn(async () => ({ fileName: "/ws/Pkg/package.mo" })),
      loadString: vi.fn(async (input) => {
        loadedFilename = input.filename;
        return { success: true };
      }),
    };

    await reloadBufferIntoOmc(
      client,
      docFor(DOC_URI, "model Model end Model;"),
    );

    expect(loadedFilename).toBe("/ws/Pkg/package.mo");
  });

  it("falls back to the document URI when the source path is non-disk", async () => {
    let loadedFilename: string | undefined;
    const client: BufferSyncClient = {
      getErrorString: vi.fn(async () => ({ errorString: "" })),
      // A memory-only / already-repointed class has no on-disk source.
      getSourceFile: vi.fn(async () => ({ fileName: "<runtime:Model>" })),
      loadString: vi.fn(async (input) => {
        loadedFilename = input.filename;
        return { success: true };
      }),
    };

    await reloadBufferIntoOmc(
      client,
      docFor(DOC_URI, "model Model end Model;"),
    );

    expect(loadedFilename).toBe(DOC_URI.toString());
  });
});

describe("isReadOnlyDocument", () => {
  it("reports false for a writable document", async () => {
    setStatReadonly(false);
    expect(await isReadOnlyDocument(docFor(DOC_URI))).toBe(false);
  });

  it("reports true for a document the source provider marked readonly", async () => {
    setStatReadonly(true);
    expect(await isReadOnlyDocument(docFor(DOC_URI))).toBe(true);
  });

  it("treats a failed stat as writable", async () => {
    const statSpy = vi
      .spyOn(vscode.workspace.fs, "stat")
      .mockRejectedValueOnce(new Error("ENOENT"));
    try {
      expect(await isReadOnlyDocument(docFor(DOC_URI))).toBe(false);
    } finally {
      statSpy.mockRestore();
    }
  });
});

describe("defaultScheduler", () => {
  it("invokes the callback after the delay and cancel prevents it", async () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      defaultScheduler.schedule(fn, 150);
      vi.advanceTimersByTime(149);
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);

      const cancelledFn = vi.fn();
      const cancelled = defaultScheduler.schedule(cancelledFn, 150);
      cancelled.cancel();
      vi.advanceTimersByTime(150);
      expect(cancelledFn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
