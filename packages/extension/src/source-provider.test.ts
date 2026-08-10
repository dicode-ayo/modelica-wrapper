/**
 * `ModelicaSourceProvider` backs the `modelica-source:` virtual filesystem.
 * These pin the graceful-degradation contract the diagram custom editor rests
 * on: a class OMC can't resolve (not yet loaded, or gone) must `stat`/`readFile`
 * as an empty file rather than surfacing VSCode's opaque "Unable to resolve
 * resource" — and the empty buffer that seeds must never be saved back over a
 * real class's source.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import type { OmcClient } from "@dicode/omc-client";

import { createSelfWriteGuard } from "./self-write-guard.js";
import type { SelfWriteGuard } from "./self-write-guard.js";
import { ModelicaSourceProvider, sourceUriFor } from "./source-provider.js";
import { WriteVerdicts } from "./write-verdict.js";

const URI = sourceUriFor("Pkg.M");

/** A client whose two source calls resolve unless told to throw. */
function makeClient(opts?: {
  getClassInformationThrows?: boolean;
  listFileThrows?: boolean;
  systemLib?: boolean;
}): { client: OmcClient; loadString: ReturnType<typeof vi.fn> } {
  const loadString = vi.fn(() => Promise.resolve({ success: true }));
  const sourceFile = opts?.systemLib
    ? "/home/u/.openmodelica/libraries/Modelica 4.0.0/Blocks/package.mo"
    : "/ws/Pkg/M.mo";
  const client = {
    getClassInformation: vi.fn(() =>
      opts?.getClassInformationThrows
        ? Promise.reject(new Error("class not loaded"))
        : Promise.resolve({ fileName: "/ws/Pkg/M.mo", fileReadOnly: false }),
    ),
    listFile: vi.fn(() =>
      opts?.listFileThrows
        ? Promise.reject(new Error("class not loaded"))
        : Promise.resolve({ contents: "model M end M;" }),
    ),
    getSourceFile: vi.fn(() => Promise.resolve({ fileName: sourceFile })),
    getModelicaPath: vi.fn(() =>
      Promise.resolve({ modelicaPath: "/home/u/.openmodelica/libraries" }),
    ),
    loadString,
    getErrorString: vi.fn(() => Promise.resolve({ errorString: "" })),
  } as unknown as OmcClient;
  return { client, loadString };
}

describe("ModelicaSourceProvider: graceful resolution", () => {
  it("stats an unresolvable class as an empty file instead of throwing", async () => {
    const { client } = makeClient({ listFileThrows: true });
    const provider = new ModelicaSourceProvider(
      () => Promise.resolve(client),
      createSelfWriteGuard(),
      new WriteVerdicts(),
    );

    const stat = await provider.stat(URI);

    expect(stat.type).toBe(vscode.FileType.File);
    expect(stat.size).toBe(0);
  });

  it("stats an empty file when ensureClient itself throws", async () => {
    const provider = new ModelicaSourceProvider(
      () => Promise.reject(new Error("OMC unavailable")),
      createSelfWriteGuard(),
      new WriteVerdicts(),
    );

    const stat = await provider.stat(URI);

    expect(stat.type).toBe(vscode.FileType.File);
    expect(stat.size).toBe(0);
  });

  it("reads an unresolvable class as empty instead of hard-failing", async () => {
    const { client } = makeClient({ listFileThrows: true });
    const provider = new ModelicaSourceProvider(
      () => Promise.resolve(client),
      createSelfWriteGuard(),
      new WriteVerdicts(),
    );

    const bytes = await provider.readFile(URI);

    expect(bytes).toEqual(new Uint8Array());
  });
});

describe("ModelicaSourceProvider: empty-source save guard", () => {
  it("refuses to persist a blank buffer over a real class (no truncation)", async () => {
    const { client, loadString } = makeClient();
    const provider = new ModelicaSourceProvider(
      () => Promise.resolve(client),
      createSelfWriteGuard(),
      new WriteVerdicts(),
    );

    await expect(
      provider.writeFile(URI, Buffer.from("   \n\t  ")),
    ).rejects.toMatchObject({ code: "Unavailable" });
    // The guard fires before any OMC mutation, so nothing truncates on disk.
    expect(loadString).not.toHaveBeenCalled();
  });
});

describe("ModelicaSourceProvider: read-only system libraries", () => {
  it("refuses to save a class whose source lives under MODELICAPATH", async () => {
    const { client, loadString } = makeClient({ systemLib: true });
    const provider = new ModelicaSourceProvider(
      () => Promise.resolve(client),
      createSelfWriteGuard(),
      new WriteVerdicts(),
    );

    await expect(
      provider.writeFile(URI, Buffer.from("model M end M;")),
    ).rejects.toMatchObject({ code: "NoPermissions" });
    // Refused before touching OMC — no chance to corrupt the installed library.
    expect(loadString).not.toHaveBeenCalled();
  });

  it("captures the origin on read, so a later save still refuses", async () => {
    // Reflecting a buffer into OMC repoints `fileName` at the buffer URI; only
    // the verdict the read captured still knows where the class came from.
    let sourceFile =
      "/home/u/.openmodelica/libraries/Modelica/Blocks/package.mo";
    const loadString = vi.fn(() => Promise.resolve({ success: true }));
    const client = {
      getSourceFile: vi.fn(() => Promise.resolve({ fileName: sourceFile })),
      getModelicaPath: vi.fn(() =>
        Promise.resolve({ modelicaPath: "/home/u/.openmodelica/libraries" }),
      ),
      getClassInformation: vi.fn(() =>
        Promise.resolve({ fileName: sourceFile, fileReadOnly: false }),
      ),
      listFile: vi.fn(() =>
        Promise.resolve({ contents: "package Blocks end Blocks;" }),
      ),
      loadString,
      getErrorString: vi.fn(() => Promise.resolve({ errorString: "" })),
    } as unknown as OmcClient;
    const provider = new ModelicaSourceProvider(
      () => Promise.resolve(client),
      createSelfWriteGuard(),
      new WriteVerdicts(),
    );
    const uri = sourceUriFor("Modelica.Blocks");

    await provider.readFile(uri);
    sourceFile = "modelica-source:/Modelica.Blocks.mo";

    await expect(
      provider.writeFile(uri, Buffer.from("package Blocks end Blocks;")),
    ).rejects.toMatchObject({ code: "NoPermissions" });
    expect(loadString).not.toHaveBeenCalled();
  });

  it("stats a system-library class with the read-only permission", async () => {
    const { client } = makeClient({ systemLib: true });
    const provider = new ModelicaSourceProvider(
      () => Promise.resolve(client),
      createSelfWriteGuard(),
      new WriteVerdicts(),
    );

    const stat = await provider.stat(URI);

    // Drives the editor's read-only view: VSCode refuses writes on the buffer.
    expect(stat.permissions).toBe(vscode.FilePermission.Readonly);
  });

  it("stats a workspace class as writable", async () => {
    const { client } = makeClient({ systemLib: false });
    const provider = new ModelicaSourceProvider(
      () => Promise.resolve(client),
      createSelfWriteGuard(),
      new WriteVerdicts(),
    );

    const stat = await provider.stat(URI);

    expect(stat.permissions).toBeUndefined();
  });

  it("stats writable when the verdict can't be derived", async () => {
    const { client } = makeClient({ getClassInformationThrows: true });
    const provider = new ModelicaSourceProvider(
      () => Promise.resolve(client),
      createSelfWriteGuard(),
      new WriteVerdicts(),
    );

    const stat = await provider.stat(URI);

    // A transient OMC error must not lock the user out of their own class.
    expect(stat.permissions).toBeUndefined();
  });
});

describe("ModelicaSourceProvider: whole-file save for shared files", () => {
  /** Guard that records writes instead of touching disk. */
  function recordingGuard(): {
    guard: SelfWriteGuard;
    write: ReturnType<typeof vi.fn>;
  } {
    const write = vi.fn(() => Promise.resolve());
    return {
      guard: { record: vi.fn(), claim: () => false, write },
      write,
    };
  }

  /** Client whose source files and `listFile` are keyed per class. */
  function sharedFileClient(opts: {
    fileName: string;
    sources: Record<string, string>;
    listing: Record<string, string>;
    /** What `parseFile` reports the file declares; one class unless given. */
    declares?: string[];
    /** What `parseString` reports the buffer declares; one class unless given. */
    bufferDeclares?: string[];
  }): { client: OmcClient; loadString: ReturnType<typeof vi.fn> } {
    const loadString = vi.fn(() => Promise.resolve({ success: true }));
    const client = {
      parseFile: vi.fn(() =>
        Promise.resolve({ classNames: opts.declares ?? ["Pkg"] }),
      ),
      parseString: vi.fn(() =>
        Promise.resolve({ classNames: opts.bufferDeclares ?? ["Pkg"] }),
      ),
      getClassInformation: vi.fn(() =>
        Promise.resolve({ fileName: opts.fileName, fileReadOnly: false }),
      ),
      getSourceFile: vi.fn(({ typeName }: { typeName: string }) =>
        Promise.resolve({ fileName: opts.sources[typeName] ?? "" }),
      ),
      listFile: vi.fn(({ typeName }: { typeName: string }) =>
        Promise.resolve({ contents: opts.listing[typeName] ?? "" }),
      ),
      getModelicaPath: vi.fn(() =>
        Promise.resolve({ modelicaPath: "/home/u/.openmodelica/libraries" }),
      ),
      loadString,
      getErrorString: vi.fn(() => Promise.resolve({ errorString: "" })),
    } as unknown as OmcClient;
    return { client, loadString };
  }

  it("writes the whole owning file, not just the edited member", async () => {
    const { client, loadString } = sharedFileClient({
      fileName: "/ws/Pkg.mo",
      sources: { "Pkg.M": "/ws/Pkg.mo", Pkg: "/ws/Pkg.mo" },
      listing: {
        Pkg: "package Pkg model M ... end M; model Other ... end Pkg;",
      },
    });
    const { guard, write } = recordingGuard();
    const provider = new ModelicaSourceProvider(
      () => Promise.resolve(client),
      guard,
      new WriteVerdicts(),
    );

    await provider.writeFile(URI, Buffer.from("model M edited end M;"));

    // Loaded under the real file so the member stays put, not the URI.
    expect(loadString).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "/ws/Pkg.mo" }),
    );
    // Wrote the whole file (owner `Pkg`'s listing), preserving `Other`.
    expect(write).toHaveBeenCalledWith(
      "/ws/Pkg.mo",
      "package Pkg model M ... end M; model Other ... end Pkg;",
    );
  });

  it("writes the buffer verbatim when the class owns its file", async () => {
    const { client } = sharedFileClient({
      fileName: "/ws/M.mo",
      sources: { "Pkg.M": "/ws/M.mo", Pkg: "/ws/package.mo" },
      listing: {},
    });
    const { guard, write } = recordingGuard();
    const provider = new ModelicaSourceProvider(
      () => Promise.resolve(client),
      guard,
      new WriteVerdicts(),
    );

    await provider.writeFile(URI, Buffer.from("model M edited end M;"));

    expect(write).toHaveBeenCalledWith("/ws/M.mo", "model M edited end M;");
  });

  it("refuses to save into a file that gained a second top-level class (#452)", async () => {
    // The load paths turn such a file away, but an external edit can add a
    // class to one already loaded. `A` owns its file as far as the scope climb
    // can tell, so without this the buffer would overwrite `B` off the disk.
    const { client } = sharedFileClient({
      fileName: "/ws/AB.mo",
      sources: { A: "/ws/AB.mo", B: "/ws/AB.mo" },
      listing: {},
      declares: ["A", "B"],
    });
    const { guard, write } = recordingGuard();
    const provider = new ModelicaSourceProvider(
      () => Promise.resolve(client),
      guard,
      new WriteVerdicts(),
    );

    await expect(
      provider.writeFile(sourceUriFor("A"), Buffer.from("model A end A;")),
    ).rejects.toThrow(/more than one top-level class/);
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a buffer that itself declares a second top-level class (#452)", async () => {
    // `loadString` would bind both classes to the file, so this is refused
    // ahead of it — the disk file still parses as a single entity.
    const { client, loadString } = sharedFileClient({
      fileName: "/ws/A.mo",
      sources: { A: "/ws/A.mo" },
      listing: {},
      declares: ["A"],
      bufferDeclares: ["A", "B"],
    });
    const { guard, write } = recordingGuard();
    const provider = new ModelicaSourceProvider(
      () => Promise.resolve(client),
      guard,
      new WriteVerdicts(),
    );

    await expect(
      provider.writeFile(
        sourceUriFor("A"),
        Buffer.from("model A end A; model B end B;"),
      ),
    ).rejects.toThrow(/more than one top-level class/);
    expect(loadString).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
