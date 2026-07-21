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
}): { client: OmcClient; loadString: ReturnType<typeof vi.fn> } {
  const loadString = vi.fn(() => Promise.resolve({ success: true }));
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
