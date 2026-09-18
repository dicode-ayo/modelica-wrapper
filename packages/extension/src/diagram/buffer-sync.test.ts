/**
 * `reloadBufferIntoOmc` pins the stale-diagnostics drain running before the
 * load, a rejected load's message coming from the *second* `getErrorString`
 * call rather than the first, and the buffer screen refusing a rename before
 * `loadString` runs.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { withErrorBuffer } from "@dicode/omc-client";
import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { renamedClassMessage } from "../single-entity-file.js";
import {
  compareBufferToClass,
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

describe("compareBufferToClass", () => {
  const listing = (contents: string) => ({
    listFile: vi.fn(async (input: { typeName: string }) => {
      expect(input.typeName).toBe("Pkg.Model");
      return { contents };
    }),
  });

  it("reports a buffer holding the class's own source verbatim", async () => {
    const source = "model Model end Model;";
    // The source comes back on a match too: a caller that renders the class
    // needs it to tell its own announced edit from somebody else's mutation.
    await expect(
      compareBufferToClass(
        listing(source),
        docFor(DOC_URI, source),
        "Pkg.Model",
      ),
    ).resolves.toEqual({ source, matches: true });
  });

  it("reports a buffer edited out from under the class", async () => {
    await expect(
      compareBufferToClass(
        listing("model Model end Model;"),
        docFor(DOC_URI, "model Model Real x; end Model;"),
        "Pkg.Model",
      ),
    ).resolves.toEqual({ source: "model Model end Model;", matches: false });
  });

  it("reports a buffer differing only in trailing whitespace", async () => {
    // The comparison is byte-exact, so a buffer VSCode normalized is reloaded
    // rather than skipped — the safe direction, but not a free equality.
    await expect(
      compareBufferToClass(
        listing("model Model end Model;"),
        docFor(DOC_URI, "model Model end Model;\n"),
        "Pkg.Model",
      ),
    ).resolves.toMatchObject({ matches: false });
  });
});

describe("reloadBufferIntoOmc", () => {
  it("screens the buffer before the clear, so only the load is drained", async () => {
    const calls: string[] = [];
    const client: BufferSyncClient = {
      parseString: vi.fn(async () => {
        calls.push("parseString");
        return { classNames: ["Pkg.Model"] };
      }),
      getSourceFile: vi.fn(async () => {
        calls.push("getSourceFile");
        return { fileName: DOC_URI.toString() };
      }),
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
    expect(calls).toEqual([
      "getSourceFile",
      "parseString",
      "getErrorString",
      "loadString",
      "getErrorString",
    ]);
  });

  it("keeps a concurrent withErrorBuffer turn from reading a diagnostic parseString left mid-screen", async () => {
    // parseString can leave a diagnostic in OMC's buffer without throwing, on
    // malformed text. Unqueued, that write could land inside an unrelated
    // withErrorBuffer turn's own clear-run-drain window and be reported as
    // that turn's own failure.
    let buffer = "";
    let releaseMutation: () => void = () => undefined;
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    let signalMutationRunning: () => void = () => undefined;
    const mutationRunning = new Promise<void>((resolve) => {
      signalMutationRunning = resolve;
    });

    const client: BufferSyncClient = {
      parseString: vi.fn(async () => {
        buffer = "Error: malformed input near line 3";
        return { classNames: ["Pkg.Model"] };
      }),
      getSourceFile: vi.fn(async () => ({ fileName: DOC_URI.toString() })),
      getErrorString: vi.fn(async () => {
        const errorString = buffer;
        buffer = "";
        return { errorString };
      }),
      loadString: vi.fn(async () => ({ success: true })),
    };

    const mutation = withErrorBuffer(client, async () => {
      signalMutationRunning();
      await mutationGate;
      return "unrelated mutation";
    });
    await mutationRunning;
    const reload = reloadBufferIntoOmc(
      client,
      docFor(DOC_URI, "model Model end Model;"),
      "Pkg.Model",
    );
    releaseMutation();

    const [mutationResult, reloadResult] = await Promise.all([
      mutation,
      reload,
    ]);

    // Queued behind the mutation's whole turn, so parseString cannot run
    // until that turn's own drain has already read an empty buffer.
    expect(mutationResult.errorString).toBe("");
    expect(reloadResult).toEqual({ ok: true });
  });

  it("keeps a load a failed screen left a diagnostic for", async () => {
    // `realSourceFilename` swallows a throwing `getSourceFile` and leaves
    // whatever OMC wrote for it behind; that is not this load's failure.
    let loaded = false;
    const client: BufferSyncClient = {
      parseString: vi.fn(async () => ({ classNames: ["Pkg.Model"] })),
      getSourceFile: vi.fn(async () => {
        throw new Error("no source file");
      }),
      getErrorString: vi.fn(async () => ({
        errorString: loaded ? "" : "Error: Class Pkg.Model not found",
      })),
      loadString: vi.fn(async () => {
        loaded = true;
        return { success: true };
      }),
    };

    await expect(
      reloadBufferIntoOmc(client, docFor(DOC_URI), "Pkg.Model"),
    ).resolves.toEqual({ ok: true });
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

  it("rejects a load OMC answered success: true but left an error for", async () => {
    // The diagnostic is left by the load, so the pre-call clear cannot
    // consume it first.
    let loaded = false;
    const client: BufferSyncClient = {
      parseString: vi.fn(async () => ({ classNames: ["Pkg.Model"] })),
      getSourceFile: vi.fn(async () => ({ fileName: DOC_URI.toString() })),
      getErrorString: vi.fn(async () => ({
        errorString: loaded ? "Error: Pkg.Model is not a valid class" : "",
      })),
      loadString: vi.fn(async () => {
        loaded = true;
        return { success: true };
      }),
    };

    const result = await reloadBufferIntoOmc(
      client,
      docFor(DOC_URI),
      "Pkg.Model",
    );

    expect(result).toEqual({
      ok: false,
      message:
        "reverse sync rejected by OMC: Error: Pkg.Model is not a valid class",
    });
  });

  it("keeps a plain warning a success", async () => {
    let loaded = false;
    const client: BufferSyncClient = {
      parseString: vi.fn(async () => ({ classNames: ["Pkg.Model"] })),
      getSourceFile: vi.fn(async () => ({ fileName: DOC_URI.toString() })),
      getErrorString: vi.fn(async () => ({
        errorString: loaded ? "Warning: unused variable x" : "",
      })),
      loadString: vi.fn(async () => {
        loaded = true;
        return { success: true };
      }),
    };

    await expect(
      reloadBufferIntoOmc(client, docFor(DOC_URI), "Pkg.Model"),
    ).resolves.toEqual({ ok: true });
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
