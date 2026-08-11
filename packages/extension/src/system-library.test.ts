import { describe, expect, it, vi } from "vitest";

import { systemLibraryVerdict } from "./system-library.js";

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
});
