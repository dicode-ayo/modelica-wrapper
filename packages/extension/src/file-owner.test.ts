import { describe, expect, it, vi } from "vitest";

import { realSourceFilename } from "./file-owner.js";

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
