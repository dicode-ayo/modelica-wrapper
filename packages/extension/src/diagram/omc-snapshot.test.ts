/**
 * Unit tests for the OMC-level undo escape hatch (issue #29).
 *
 * Drives `captureSnapshot` / `restoreSnapshot` with a hand-rolled
 * `SnapshotClient` mock — no real OMC. Asserts:
 *   - capture stitches `listFile` contents + `getSourceFile` filename
 *   - capture is non-fatal (returns undefined) for unlistable / built-in
 *     classes and on a thrown `listFile`
 *   - capture falls back to a synthetic filename when there's no source binding
 *   - restore replays the exact captured text via `loadString`
 */

import { describe, expect, it, vi } from "vitest";

import {
  captureSnapshot,
  restoreSnapshot,
  type OmcSnapshot,
  type SnapshotClient,
} from "./omc-snapshot.js";

interface MockOpts {
  listFile?: string | (() => Promise<{ contents: string }>);
  sourceFile?: string | (() => Promise<{ fileName: string }>);
  loadStringSuccess?: boolean;
}

function mockClient(opts: MockOpts = {}): {
  client: SnapshotClient;
  loadString: ReturnType<typeof vi.fn>;
  listFile: ReturnType<typeof vi.fn>;
  getSourceFile: ReturnType<typeof vi.fn>;
} {
  const listFile = vi.fn(async () => {
    if (typeof opts.listFile === "function") return opts.listFile();
    return { contents: opts.listFile ?? "model M\nend M;\n" };
  });
  const getSourceFile = vi.fn(async () => {
    if (typeof opts.sourceFile === "function") return opts.sourceFile();
    return { fileName: opts.sourceFile ?? "/ws/M.mo" };
  });
  const loadString = vi.fn(async () => ({
    success: opts.loadStringSuccess ?? true,
  }));
  const client: SnapshotClient = { listFile, getSourceFile, loadString };
  return { client, loadString, listFile, getSourceFile };
}

describe("captureSnapshot", () => {
  it("returns the listed text + source filename for a normal class", async () => {
    const { client, listFile, getSourceFile } = mockClient({
      listFile: "model M\n  Real x;\nend M;\n",
      sourceFile: "/ws/M.mo",
    });

    const snap = await captureSnapshot(client, "M");

    expect(snap).toEqual({
      className: "M",
      filename: "/ws/M.mo",
      contents: "model M\n  Real x;\nend M;\n",
    });
    expect(listFile).toHaveBeenCalledWith({ typeName: "M" });
    expect(getSourceFile).toHaveBeenCalledWith({ typeName: "M" });
  });

  it("falls back to a synthetic filename when there is no source binding", async () => {
    const { client } = mockClient({ sourceFile: "" });

    const snap = await captureSnapshot(client, "Loaded.ViaString");

    expect(snap?.filename).toBe("<snapshot:Loaded.ViaString>");
    expect(snap?.contents).toBe("model M\nend M;\n");
  });

  it("returns undefined (non-fatal) when listFile yields empty source", async () => {
    const { client, getSourceFile } = mockClient({ listFile: "" });

    const snap = await captureSnapshot(client, "Modelica.SIunits.Time");

    expect(snap).toBeUndefined();
    // No point asking for the source file once we know there's nothing to save.
    expect(getSourceFile).not.toHaveBeenCalled();
  });

  it("returns undefined when listFile throws", async () => {
    const { client } = mockClient({
      listFile: async () => {
        throw new Error("no such class");
      },
    });

    const snap = await captureSnapshot(client, "Bogus");

    expect(snap).toBeUndefined();
  });

  it("still snapshots when getSourceFile throws (synthetic filename)", async () => {
    const { client } = mockClient({
      sourceFile: async () => {
        throw new Error("symbol table miss");
      },
    });

    const snap = await captureSnapshot(client, "M");

    expect(snap?.filename).toBe("<snapshot:M>");
    expect(snap?.contents).toBe("model M\nend M;\n");
  });
});

describe("restoreSnapshot", () => {
  it("replays the captured text via loadString and reports success", async () => {
    const { client, loadString } = mockClient({ loadStringSuccess: true });
    const snapshot: OmcSnapshot = {
      className: "M",
      filename: "/ws/M.mo",
      contents: "model M\n  Real x = 1;\nend M;\n",
    };

    const ok = await restoreSnapshot(client, snapshot);

    expect(ok).toBe(true);
    expect(loadString).toHaveBeenCalledWith({
      data: "model M\n  Real x = 1;\nend M;\n",
      filename: "/ws/M.mo",
    });
  });

  it("propagates a false loadString result", async () => {
    const { client } = mockClient({ loadStringSuccess: false });
    const ok = await restoreSnapshot(client, {
      className: "M",
      filename: "/ws/M.mo",
      contents: "model M\nend M;\n",
    });
    expect(ok).toBe(false);
  });
});
