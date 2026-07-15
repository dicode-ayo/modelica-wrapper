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
    // Loaded.ViaString is package-nested, so the snapshot prefixes a
    // `within Loaded;` clause (issue #76, item 2).
    expect(snap?.contents).toBe("within Loaded;\nmodel M\nend M;\n");
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

  it("leaves top-level class source untouched (no within clause)", async () => {
    const { client } = mockClient({
      listFile: "model Top\n  Real x;\nend Top;\n",
    });
    const snap = await captureSnapshot(client, "Top");
    expect(snap?.contents).toBe("model Top\n  Real x;\nend Top;\n");
  });

  it("prefixes a `within` clause for a package-nested class (issue #76, item 2)", async () => {
    // listFile(Pkg.Foo) returns only the bare `model Foo … end Foo;` body.
    // Without the enclosing-scope clause, restoring it would re-create Foo at
    // the top level instead of inside Pkg.
    const { client } = mockClient({
      listFile: "model Foo\n  Real y = 2;\nend Foo;\n",
      sourceFile: "/ws/Pkg.mo",
    });
    const snap = await captureSnapshot(client, "Pkg.Foo");
    expect(snap?.contents).toBe(
      "within Pkg;\nmodel Foo\n  Real y = 2;\nend Foo;\n",
    );
  });

  it("uses the full enclosing path for a deeply-nested class", async () => {
    const { client } = mockClient({
      listFile: "model Foo\nend Foo;\n",
    });
    const snap = await captureSnapshot(client, "A.B.C.Foo");
    expect(snap?.contents).toBe("within A.B.C;\nmodel Foo\nend Foo;\n");
  });

  it("keeps a quoted identifier containing a dot inside the enclosing scope", async () => {
    // `'a.b'` is a single Q-IDENT segment (Modelica spec §2.3.1); the
    // enclosing scope is `Pkg.'a.b'`, not `Pkg.'a`.
    const { client } = mockClient({
      listFile: "model Foo\nend Foo;\n",
    });
    const snap = await captureSnapshot(client, "Pkg.'a.b'.Foo");
    expect(snap?.contents).toBe("within Pkg.'a.b';\nmodel Foo\nend Foo;\n");
  });

  it("does not double a within clause OMC already emitted", async () => {
    const { client } = mockClient({
      listFile: "within Pkg;\nmodel Foo\nend Foo;\n",
    });
    const snap = await captureSnapshot(client, "Pkg.Foo");
    expect(snap?.contents).toBe("within Pkg;\nmodel Foo\nend Foo;\n");
  });
});

describe("captureSnapshot → restoreSnapshot round-trip for nested classes", () => {
  it("restores a nested class with its within clause via merge:false", async () => {
    const { client, loadString } = mockClient({
      listFile: "model Foo\n  Real y = 2;\nend Foo;\n",
      sourceFile: "/ws/Pkg.mo",
    });
    const snap = await captureSnapshot(client, "Pkg.Foo");
    expect(snap).toBeDefined();

    const ok = await restoreSnapshot(client, snap!);
    expect(ok).toBe(true);
    expect(loadString).toHaveBeenCalledWith({
      data: "within Pkg;\nmodel Foo\n  Real y = 2;\nend Foo;\n",
      filename: "/ws/Pkg.mo",
      merge: false,
    });
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
      merge: false,
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
