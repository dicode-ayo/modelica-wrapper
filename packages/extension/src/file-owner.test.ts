import { describe, expect, it, vi } from "vitest";

import { fileOwnerClass } from "./file-owner.js";

/** A client whose `getSourceFile` answers from a class→file map. */
function makeClient(files: Record<string, string>) {
  return {
    getSourceFile: vi.fn(async ({ typeName }: { typeName: string }) => {
      const fileName = files[typeName];
      if (fileName === undefined) throw new Error(`no source for ${typeName}`);
      return { fileName };
    }),
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
