import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { systemLibraryRoots, systemLibraryVerdict } from "./system-library.js";

function makeClient(
  fileName: string,
  modelicaPath = "/home/u/.openmodelica/libraries",
) {
  return {
    getSourceFile: vi.fn(async () => ({ fileName })),
    getModelicaPath: vi.fn(async () => ({ modelicaPath })),
  };
}

describe("systemLibraryVerdict", () => {
  it("is true for a class whose source lives under a MODELICAPATH entry", async () => {
    const client = makeClient(
      "/home/u/.openmodelica/libraries/Modelica 4.0.0+maint.om/Blocks/package.mo",
    );
    expect(await systemLibraryVerdict(client, "Modelica.Blocks")).toBe(true);
  });

  it("is false for a workspace class outside MODELICAPATH", async () => {
    const client = makeClient("/home/u/project/MyLib/Resistor.mo");
    expect(await systemLibraryVerdict(client, "MyLib.Resistor")).toBe(false);
  });

  it("honors multiple MODELICAPATH entries", async () => {
    const client = makeClient(
      "/opt/om/lib/omlibrary/Complex 4.0.0/package.mo",
      "/home/u/.openmodelica/libraries:/opt/om/lib/omlibrary",
    );
    expect(await systemLibraryVerdict(client, "Complex")).toBe(true);
  });

  it("is inconclusive once the source path was repointed to a scheme URI", async () => {
    // A prior reverse-sync loadString repoints fileName away from disk; the
    // origin can no longer be derived, and must not read as writable either.
    const client = makeClient("modelica-source:/Modelica.Blocks.Foo.mo");
    expect(await systemLibraryVerdict(client, "Modelica.Blocks.Foo")).toBe(
      undefined,
    );
  });

  it("is inconclusive for a memory-only class with no bound file", async () => {
    // A not-yet-loaded class has no source path to classify — the caller must
    // not cache this as writable.
    expect(await systemLibraryVerdict(makeClient(""), "Scratch")).toBe(
      undefined,
    );
  });

  it("reads MODELICAPATH once per client across classes", async () => {
    const client = makeClient("/home/u/project/MyLib/A.mo");
    await systemLibraryVerdict(client, "MyLib.A");
    await systemLibraryVerdict(client, "MyLib.B");
    expect(client.getModelicaPath).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight read between concurrent verdicts", async () => {
    const client = makeClient("/home/u/project/MyLib/A.mo");
    await Promise.all([
      systemLibraryVerdict(client, "MyLib.A"),
      systemLibraryVerdict(client, "MyLib.B"),
    ]);
    expect(client.getModelicaPath).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed read", async () => {
    const client = makeClient("/home/u/project/MyLib/A.mo");
    client.getModelicaPath.mockRejectedValueOnce(new Error("omc gone"));
    await expect(systemLibraryVerdict(client, "MyLib.A")).rejects.toThrow(
      "omc gone",
    );
    expect(await systemLibraryVerdict(client, "MyLib.A")).toBe(false);
    expect(client.getModelicaPath).toHaveBeenCalledTimes(2);
  });

  it("judges against the first read even after the path is widened", async () => {
    // Widening the path is how `modelica.modelicaPath` adds a vendored
    // project library; reading the live path again would make that library
    // read-only.
    let modelicaPath = "/usr/lib/omlibrary";
    const client = {
      getSourceFile: vi.fn(async () => ({
        fileName: "/ws/lib/MyLib/package.mo",
      })),
      getModelicaPath: vi.fn(async () => ({ modelicaPath })),
    };
    expect(await systemLibraryRoots(client)).toEqual(["/usr/lib/omlibrary"]);
    modelicaPath = ["/ws/lib", "/usr/lib/omlibrary"].join(path.delimiter);

    expect(await systemLibraryVerdict(client, "MyLib")).toBe(false);
  });

  it("does not ask for MODELICAPATH when the class has no disk source", async () => {
    const client = makeClient("");
    await systemLibraryVerdict(client, "Scratch");
    expect(client.getModelicaPath).not.toHaveBeenCalled();
  });
});
