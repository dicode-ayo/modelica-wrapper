import { describe, expect, it, vi } from "vitest";

import {
  isSystemLibraryClass,
  systemLibraryVerdict,
} from "./system-library.js";

function makeClient(
  fileName: string,
  modelicaPath = "/home/u/.openmodelica/libraries",
) {
  return {
    getSourceFile: vi.fn(async () => ({ fileName })),
    getModelicaPath: vi.fn(async () => ({ modelicaPath })),
  };
}

describe("isSystemLibraryClass", () => {
  it("is true for a class whose source lives under a MODELICAPATH entry", async () => {
    const client = makeClient(
      "/home/u/.openmodelica/libraries/Modelica 4.0.0+maint.om/Blocks/package.mo",
    );
    expect(await isSystemLibraryClass(client, "Modelica.Blocks")).toBe(true);
  });

  it("is false for a workspace class outside MODELICAPATH", async () => {
    const client = makeClient("/home/u/project/MyLib/Resistor.mo");
    expect(await isSystemLibraryClass(client, "MyLib.Resistor")).toBe(false);
  });

  it("is false when the source path was already repointed to a scheme URI", async () => {
    // A prior reverse-sync loadString repoints fileName away from disk; the
    // verdict can no longer be derived, so it must not claim system-library.
    const client = makeClient("modelica-source:/Modelica.Blocks.Foo.mo");
    expect(await isSystemLibraryClass(client, "Modelica.Blocks.Foo")).toBe(
      false,
    );
  });

  it("is false for a memory-only class with no bound file", async () => {
    const client = makeClient("");
    expect(await isSystemLibraryClass(client, "Scratch")).toBe(false);
  });

  it("honors multiple MODELICAPATH entries", async () => {
    const client = makeClient(
      "/opt/om/lib/omlibrary/Complex 4.0.0/package.mo",
      "/home/u/.openmodelica/libraries:/opt/om/lib/omlibrary",
    );
    expect(await isSystemLibraryClass(client, "Complex")).toBe(true);
  });
});

describe("systemLibraryVerdict", () => {
  it("returns true/false when the class's origin is resolvable", async () => {
    expect(
      await systemLibraryVerdict(
        makeClient("/home/u/.openmodelica/libraries/Modelica/package.mo"),
        "Modelica",
      ),
    ).toBe(true);
    expect(
      await systemLibraryVerdict(makeClient("/ws/MyLib/R.mo"), "MyLib.R"),
    ).toBe(false);
  });

  it("returns undefined for an unresolved class (no on-disk source)", async () => {
    // A not-yet-loaded class has no source path to classify — the caller must
    // not cache this as writable.
    expect(await systemLibraryVerdict(makeClient(""), "Not.Loaded")).toBe(
      undefined,
    );
  });
});
