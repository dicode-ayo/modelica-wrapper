/**
 * `reloadBufferIntoOmc` pins the stale-diagnostics drain running before the
 * load, a rejected load's message coming from the *second* `getErrorString`
 * call rather than the first, and the buffer screen refusing a rename before
 * `loadString` runs.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { renamedClassMessage } from "../single-entity-file.js";
import {
  bufferMatchesClass,
  defaultScheduler,
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

describe("bufferMatchesClass", () => {
  const listing = (contents: string) => ({
    listFile: async () => ({ contents }),
  });

  it("reports a buffer holding the class's own source verbatim", async () => {
    const source = "model Model end Model;";
    await expect(
      bufferMatchesClass(listing(source), docFor(DOC_URI, source), "Pkg.Model"),
    ).resolves.toBe(true);
  });

  it("reports a buffer edited out from under the class", async () => {
    await expect(
      bufferMatchesClass(
        listing("model Model end Model;"),
        docFor(DOC_URI, "model Model Real x; end Model;"),
        "Pkg.Model",
      ),
    ).resolves.toBe(false);
  });
});

describe("reloadBufferIntoOmc", () => {
  it("drains stale diagnostics before loading the buffer's text", async () => {
    const calls: string[] = [];
    const client: BufferSyncClient = {
      parseString: vi.fn(async () => ({ classNames: ["Pkg.Model"] })),
      getSourceFile: vi.fn(async () => ({ fileName: DOC_URI.toString() })),
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
      "Pkg.Model",
    );

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(["getErrorString", "loadString"]);
  });

  it("refuses a buffer declaring several top-level classes (#452)", async () => {
    // `loadString` binds every class in the text to `filename`, so letting this
    // through would mint the shape every load path refuses — on a file that
    // still parses clean from disk.
    const client: BufferSyncClient = {
      parseString: vi.fn(async () => ({ classNames: ["A", "B"] })),
      getSourceFile: vi.fn(async () => ({ fileName: DOC_URI.toString() })),
      getErrorString: vi.fn(async () => ({ errorString: "" })),
      loadString: vi.fn(async () => ({ success: true })),
    };

    const result = await reloadBufferIntoOmc(
      client,
      docFor(DOC_URI, "model A end A; model B end B;"),
      "A",
    );

    expect(result.ok).toBe(false);
    expect(client.loadString).not.toHaveBeenCalled();
  });

  it("refuses a buffer that renamed its class (#461)", async () => {
    const client: BufferSyncClient = {
      parseString: vi.fn(async () => ({ classNames: ["Pkg.Renamed"] })),
      getSourceFile: vi.fn(async () => ({ fileName: DOC_URI.toString() })),
      getErrorString: vi.fn(async () => ({ errorString: "" })),
      loadString: vi.fn(async () => ({ success: true })),
    };

    const result = await reloadBufferIntoOmc(
      client,
      docFor(DOC_URI, "model Renamed end Renamed;"),
      "Pkg.Model",
    );

    expect(result).toEqual({
      ok: false,
      message: renamedClassMessage("Pkg.Model", "Pkg.Renamed"),
    });
    expect(client.loadString).not.toHaveBeenCalled();
  });

  it("reports the post-load error, not the drained pre-load one", async () => {
    const errorStrings = [
      "stale error from a prior edit",
      "the real rejection",
    ];
    const client: BufferSyncClient = {
      parseString: vi.fn(async () => ({ classNames: ["Pkg.Model"] })),
      getSourceFile: vi.fn(async () => ({ fileName: DOC_URI.toString() })),
      getErrorString: vi.fn(async () => ({
        errorString: errorStrings.shift() ?? "",
      })),
      loadString: vi.fn(async () => ({ success: false })),
    };

    const result = await reloadBufferIntoOmc(
      client,
      docFor(DOC_URI),
      "Pkg.Model",
    );

    expect(result).toEqual({
      ok: false,
      message: "reverse sync rejected by OMC: the real rejection",
    });
  });

  it("falls back to a generic message when OMC reports no error text", async () => {
    const client: BufferSyncClient = {
      parseString: vi.fn(async () => ({ classNames: ["Pkg.Model"] })),
      getSourceFile: vi.fn(async () => ({ fileName: DOC_URI.toString() })),
      getErrorString: vi.fn(async () => ({ errorString: "" })),
      loadString: vi.fn(async () => ({ success: false })),
    };

    const result = await reloadBufferIntoOmc(
      client,
      docFor(DOC_URI),
      "Pkg.Model",
    );

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
      parseString: vi.fn(async () => ({ classNames: ["Pkg.Model"] })),
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
      "Pkg.Model",
    );

    expect(loadedFilename).toBe("/ws/Pkg/package.mo");
  });

  it("falls back to the document URI when the source path is non-disk", async () => {
    let loadedFilename: string | undefined;
    const client: BufferSyncClient = {
      parseString: vi.fn(async () => ({ classNames: ["Pkg.Model"] })),
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
      "Pkg.Model",
    );

    expect(loadedFilename).toBe(DOC_URI.toString());
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
