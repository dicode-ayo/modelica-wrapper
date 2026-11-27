import { delimiter } from "node:path";

import { describe, expect, it } from "vitest";

import { createFsWriteVerdicts } from "./fs-verdicts.js";
import type { WriteVerdictClient } from "./write-verdict.js";

const LIBRARY_ROOT = "/home/me/.openmodelica/libraries";
const LIBRARY_FILE = `${LIBRARY_ROOT}/Modelica 4.1.0+maint.om/Blocks/Math.mo`;

interface Fake extends WriteVerdictClient {
  pathReads: number;
}

function fake(
  over: Partial<{
    fileName: string;
    modelicaPath: string | (() => string);
    fileReadOnly: boolean;
  }> = {},
): Fake {
  const self: Fake = {
    pathReads: 0,
    getSourceFile: async () => ({ fileName: over.fileName ?? "/w/Demo.mo" }),
    getModelicaPath: async () => {
      self.pathReads += 1;
      const { modelicaPath = `${LIBRARY_ROOT}${delimiter}/usr/lib/omlibrary` } =
        over;
      return {
        modelicaPath:
          typeof modelicaPath === "function" ? modelicaPath() : modelicaPath,
      };
    },
    getClassInformation: async () => ({
      fileReadOnly: over.fileReadOnly ?? false,
    }),
  };
  return self;
}

const log = {
  warnings: [] as string[],
  warn(message: string) {
    this.warnings.push(message);
  },
  info: () => undefined,
};

describe("filesystem write verdicts", () => {
  it("refuses a class whose source lies under a MODELICAPATH entry", async () => {
    const verdicts = createFsWriteVerdicts(log);

    const verdict = await verdicts.forClass(
      fake({ fileName: LIBRARY_FILE }),
      "Modelica.Blocks.Math.Sin",
      "edit",
    );

    expect(verdict).toEqual({
      ok: false,
      reason:
        "Cannot edit Modelica.Blocks.Math.Sin — it belongs to a read-only system library.",
    });
  });

  it("refuses a class whose source file is read-only, worded by the action", async () => {
    const verdicts = createFsWriteVerdicts(log);
    const client = fake({ fileReadOnly: true });

    expect(await verdicts.forClass(client, "Demo", "save")).toEqual({
      ok: false,
      reason: "Cannot save Demo — its source file is read-only.",
    });
    expect(await verdicts.forClass(client, "Demo", "createInside")).toEqual({
      ok: false,
      reason:
        "Cannot create a class inside Demo — its source file is read-only.",
    });
  });

  it("allows a writable class outside every library root", async () => {
    const verdicts = createFsWriteVerdicts(log);

    expect(await verdicts.forClass(fake(), "Demo", "edit")).toEqual({
      ok: true,
    });
  });

  it("does not read a sibling directory sharing a root's prefix as inside it", async () => {
    const verdicts = createFsWriteVerdicts(log);

    const verdict = await verdicts.forClass(
      fake({ fileName: `${LIBRARY_ROOT}-mine/Demo.mo` }),
      "Demo",
      "edit",
    );

    expect(verdict).toEqual({ ok: true });
  });

  it("judges a class with no on-disk source by its file permission alone", async () => {
    const verdicts = createFsWriteVerdicts(log);

    expect(
      await verdicts.forClass(
        fake({ fileName: "<interactive>", fileReadOnly: true }),
        "Demo",
        "edit",
      ),
    ).toMatchObject({
      ok: false,
      reason: expect.stringContaining("read-only."),
    });
  });

  it("refuses a single-file library listed as a MODELICAPATH entry itself", async () => {
    const verdicts = createFsWriteVerdicts(log);
    const file = `${LIBRARY_ROOT}/Single.mo`;

    expect(
      await verdicts.forClass(
        fake({ fileName: file, modelicaPath: file }),
        "Single",
        "edit",
      ),
    ).toMatchObject({ ok: false });
  });

  it("fails open, and says so, when OMC cannot answer", async () => {
    const verdicts = createFsWriteVerdicts(log);
    const client: WriteVerdictClient = {
      ...fake(),
      getSourceFile: () => Promise.reject(new Error("omc client closed")),
    };

    expect(await verdicts.forClass(client, "Demo", "edit")).toEqual({
      ok: true,
    });
    expect(log.warnings.at(-1)).toContain("omc client closed");
  });

  it("keeps the first MODELICAPATH a client reported, however it narrows later", async () => {
    const verdicts = createFsWriteVerdicts(log);
    let modelicaPath = LIBRARY_ROOT;
    const client = fake({
      fileName: LIBRARY_FILE,
      modelicaPath: () => modelicaPath,
    });

    await verdicts.forClass(client, "Modelica.Blocks.Math.Sin", "edit");
    modelicaPath = "/elsewhere";

    expect(
      await verdicts.forClass(client, "Modelica.Blocks.Math.Sin", "edit"),
    ).toMatchObject({ ok: false });
    expect(await verdicts.systemLibraryRoots?.(client)).toEqual([LIBRARY_ROOT]);
    expect(client.pathReads).toBe(1);
  });

  it("asks again after a MODELICAPATH read failed", async () => {
    const verdicts = createFsWriteVerdicts(log);
    let fail = true;
    const client = fake({
      fileName: LIBRARY_FILE,
      modelicaPath: () => {
        if (fail) throw new Error("transient");
        return LIBRARY_ROOT;
      },
    });

    expect(await verdicts.forClass(client, "Modelica.Blocks", "edit")).toEqual({
      ok: true,
    });
    fail = false;

    expect(
      await verdicts.forClass(client, "Modelica.Blocks", "edit"),
    ).toMatchObject({ ok: false });
  });
});
