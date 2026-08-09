import { describe, expect, it, vi } from "vitest";

import {
  fileOwnerClass,
  fileTopLevelSiblings,
  realSourceFilename,
} from "./file-owner.js";

/** A client whose `getSourceFile` answers from a class→file map. */
function makeClient(
  files: Record<string, string>,
  parsed: Record<string, string[]> = {},
) {
  return {
    getSourceFile: vi.fn(async ({ typeName }: { typeName: string }) => {
      const fileName = files[typeName];
      if (fileName === undefined) throw new Error(`no source for ${typeName}`);
      return { fileName };
    }),
    parseFile: vi.fn(async ({ fileName }: { fileName: string }) => ({
      classNames: parsed[fileName] ?? [],
    })),
  };
}

describe("fileOwnerClass", () => {
  it("returns the class itself when it owns its file", async () => {
    const client = makeClient({
      "ResistorDemo.Resistor": "/ws/ResistorDemo/Resistor.mo",
      ResistorDemo: "/ws/ResistorDemo/package.mo",
    });
    expect(await fileOwnerClass(client, "ResistorDemo.Resistor")).toBe(
      "ResistorDemo.Resistor",
    );
  });

  it("walks up to the outermost class sharing the file (inline member)", async () => {
    const shared = "/msl/Blocks/package.mo";
    const client = makeClient({
      "Modelica.Blocks.Examples.PID_Controller": shared,
      "Modelica.Blocks.Examples": shared,
      "Modelica.Blocks": shared,
      Modelica: "/msl/package.mo",
    });
    expect(
      await fileOwnerClass(client, "Modelica.Blocks.Examples.PID_Controller"),
    ).toBe("Modelica.Blocks");
  });

  it("stops at the file boundary, not the package root", async () => {
    const client = makeClient({
      "MyPkg.Sub.A": "/ws/MyPkg/Sub.mo",
      "MyPkg.Sub": "/ws/MyPkg/Sub.mo",
      MyPkg: "/ws/MyPkg/package.mo",
    });
    // Sub.mo holds Sub + A inline; MyPkg lives in a different file.
    expect(await fileOwnerClass(client, "MyPkg.Sub.A")).toBe("MyPkg.Sub");
  });

  it("returns the class when an ancestor's source can't be resolved", async () => {
    const client = makeClient({ "A.B": "/ws/A/B.mo" });
    expect(await fileOwnerClass(client, "A.B")).toBe("A.B");
  });
});

describe("fileTopLevelSiblings", () => {
  it("returns just the one class when it owns its file alone", async () => {
    const client = makeClient({}, { "/ws/M.mo": ["M"] });
    expect(await fileTopLevelSiblings(client, "/ws/M.mo")).toEqual(["M"]);
  });

  it("returns every top-level class two unrelated siblings share a file with (#452)", async () => {
    const client = makeClient({}, { "/ws/AB.mo": ["A", "B"] });
    expect(await fileTopLevelSiblings(client, "/ws/AB.mo")).toEqual(["A", "B"]);
  });

  it("filters out nested members, keeping only top-level names", async () => {
    const client = makeClient(
      {},
      { "/ws/Pkg/package.mo": ["Foo", "Foo.Bar", "Baz"] },
    );
    expect(await fileTopLevelSiblings(client, "/ws/Pkg/package.mo")).toEqual([
      "Foo",
      "Baz",
    ]);
  });
});

describe("realSourceFilename", () => {
  it("resolves the on-disk file a class is stored in", async () => {
    const client = makeClient({ "P.A": "/ws/P/package.mo" });
    expect(await realSourceFilename(client, "P.A")).toBe("/ws/P/package.mo");
  });

  it.each(["<interactive>", "modelica-source:/P.A.mo", ""])(
    "reports no source file for the pseudo-filename %o",
    async (fileName) => {
      const client = makeClient({ "P.A": fileName });
      expect(await realSourceFilename(client, "P.A")).toBeUndefined();
    },
  );

  it("reports no source file when the class is unknown to OMC", async () => {
    const client = makeClient({});
    expect(await realSourceFilename(client, "P.A")).toBeUndefined();
  });

  it("reports no source file without a class name", async () => {
    const client = makeClient({ "P.A": "/ws/P/package.mo" });
    expect(await realSourceFilename(client, undefined)).toBeUndefined();
    expect(client.getSourceFile).not.toHaveBeenCalled();
  });
});
