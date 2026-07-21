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
import { ModelicaSourceProvider, sourceUriFor } from "./source-provider.js";

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
    const { client } = makeClient({ getClassInformationThrows: true });
    const provider = new ModelicaSourceProvider(
      () => Promise.resolve(client),
      createSelfWriteGuard(),
    );

    const stat = await provider.stat(URI);

    expect(stat.type).toBe(vscode.FileType.File);
    expect(stat.size).toBe(0);
  });

  it("stats an empty file when ensureClient itself throws", async () => {
    const provider = new ModelicaSourceProvider(
      () => Promise.reject(new Error("OMC unavailable")),
      createSelfWriteGuard(),
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
    );

    await expect(
      provider.writeFile(URI, Buffer.from("model M end M;")),
    ).rejects.toMatchObject({ code: "NoPermissions" });
    // Refused before touching OMC — no chance to corrupt the installed library.
    expect(loadString).not.toHaveBeenCalled();
  });

  it("verdicts a MODELICAPATH class read-only and a workspace class writable", async () => {
    const { client: sys } = makeClient({ systemLib: true });
    const { client: ws } = makeClient({ systemLib: false });
    const sysProvider = new ModelicaSourceProvider(
      () => Promise.resolve(sys),
      createSelfWriteGuard(),
    );
    const wsProvider = new ModelicaSourceProvider(
      () => Promise.resolve(ws),
      createSelfWriteGuard(),
    );

    expect(await sysProvider.isReadOnly("Modelica.Blocks")).toBe(true);
    expect(await wsProvider.isReadOnly("Pkg.M")).toBe(false);
  });
});
