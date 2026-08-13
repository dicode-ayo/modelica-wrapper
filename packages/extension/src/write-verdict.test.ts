/**
 * The write verdict is the only gate between a user gesture and an installed
 * library's source, so these pin both directions: a system-library class is
 * refused however its files are chmod'ed, and every derivation failure still
 * resolves as writable rather than locking the user out of their own model.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { WriteVerdicts, type WriteVerdictClient } from "./write-verdict.js";

const MODELICA_PATH = "/home/u/.openmodelica/libraries";
const SYSTEM_FILE = `${MODELICA_PATH}/Modelica 4.0.0/Blocks/package.mo`;

function makeClient(opts?: {
  sourceFile?: string;
  fileReadOnly?: boolean;
  sourceFileThrows?: boolean;
  classInformationThrows?: boolean;
}): WriteVerdictClient {
  return {
    getSourceFile: vi.fn(() =>
      opts?.sourceFileThrows
        ? Promise.reject(new Error("OMC busy"))
        : Promise.resolve({ fileName: opts?.sourceFile ?? "/ws/Pkg/M.mo" }),
    ),
    getModelicaPath: vi.fn(() =>
      Promise.resolve({ modelicaPath: MODELICA_PATH }),
    ),
    getClassInformation: vi.fn(() =>
      opts?.classInformationThrows
        ? Promise.reject(new Error("class not loaded"))
        : Promise.resolve({ fileReadOnly: opts?.fileReadOnly ?? false }),
    ),
  };
}

function docFor(uri: vscode.Uri): vscode.TextDocument {
  return { uri } as unknown as vscode.TextDocument;
}

describe("WriteVerdicts.forClass", () => {
  it("allows a workspace class", async () => {
    const verdict = await new WriteVerdicts().forClass(
      makeClient(),
      "Pkg.M",
      "edit",
    );

    expect(verdict).toEqual({ ok: true });
  });

  it("refuses a MODELICAPATH class whose file is writable on disk", async () => {
    const client = makeClient({ sourceFile: SYSTEM_FILE, fileReadOnly: false });

    const verdict = await new WriteVerdicts().forClass(
      client,
      "Modelica.Blocks",
      "edit",
    );

    expect(verdict).toEqual({
      ok: false,
      reason:
        "Cannot edit Modelica.Blocks — it belongs to a read-only system library.",
    });
  });

  it("refuses a class OMC reports as a read-only file", async () => {
    const client = makeClient({ fileReadOnly: true });

    const verdict = await new WriteVerdicts().forClass(client, "Pkg.M", "save");

    expect(verdict).toEqual({
      ok: false,
      reason: "Cannot save Pkg.M — its source file is read-only.",
    });
  });

  it("names the action in the refusal", async () => {
    const verdicts = new WriteVerdicts();
    const client = makeClient({ sourceFile: SYSTEM_FILE });

    const created = await verdicts.forClass(
      client,
      "Modelica.Blocks",
      "createInside",
    );

    expect(created).toEqual({
      ok: false,
      reason:
        "Cannot create a class inside Modelica.Blocks — it belongs to a read-only system library.",
    });
  });

  it("keeps the origin verdict captured before a mutation repointed the class", async () => {
    // A save reflects the buffer into OMC, which repoints `fileName` at the
    // `modelica-source:` URI — the origin is unrecoverable from then on.
    let sourceFile = SYSTEM_FILE;
    const client: WriteVerdictClient = {
      getSourceFile: vi.fn(() => Promise.resolve({ fileName: sourceFile })),
      getModelicaPath: vi.fn(() =>
        Promise.resolve({ modelicaPath: MODELICA_PATH }),
      ),
      getClassInformation: vi.fn(() =>
        Promise.resolve({ fileReadOnly: false }),
      ),
    };
    const verdicts = new WriteVerdicts();
    await verdicts.capture(client, "Modelica.Blocks");

    sourceFile = "modelica-source:/Modelica.Blocks.mo";
    const verdict = await verdicts.forClass(client, "Modelica.Blocks", "edit");

    expect(verdict.ok).toBe(false);
  });

  it("re-evaluates a class OMC could not resolve yet", async () => {
    let sourceFile = "";
    const client: WriteVerdictClient = {
      getSourceFile: vi.fn(() => Promise.resolve({ fileName: sourceFile })),
      getModelicaPath: vi.fn(() =>
        Promise.resolve({ modelicaPath: MODELICA_PATH }),
      ),
      getClassInformation: vi.fn(() =>
        Promise.resolve({ fileReadOnly: false }),
      ),
    };
    const verdicts = new WriteVerdicts();

    expect(
      (await verdicts.forClass(client, "Modelica.Blocks", "edit")).ok,
    ).toBe(true);
    sourceFile = SYSTEM_FILE;
    expect(
      (await verdicts.forClass(client, "Modelica.Blocks", "edit")).ok,
    ).toBe(false);
  });

  it("re-reads the file permission on every question", async () => {
    // A `chmod` changes `fileReadOnly` under us, so memoizing it would strand a
    // user who just made their own file writable again.
    let fileReadOnly = true;
    const client: WriteVerdictClient = {
      getSourceFile: vi.fn(() => Promise.resolve({ fileName: "/ws/Pkg/M.mo" })),
      getModelicaPath: vi.fn(() =>
        Promise.resolve({ modelicaPath: MODELICA_PATH }),
      ),
      getClassInformation: vi.fn(() => Promise.resolve({ fileReadOnly })),
    };
    const verdicts = new WriteVerdicts();

    expect((await verdicts.forClass(client, "Pkg.M", "edit")).ok).toBe(false);
    fileReadOnly = false;
    expect((await verdicts.forClass(client, "Pkg.M", "edit")).ok).toBe(true);
  });

  it("treats a failed origin lookup as writable", async () => {
    const client = makeClient({ sourceFileThrows: true });

    const verdict = await new WriteVerdicts().forClass(client, "Pkg.M", "edit");

    expect(verdict).toEqual({ ok: true });
  });

  it("treats a failed permission lookup as writable", async () => {
    const client = makeClient({ classInformationThrows: true });

    const verdict = await new WriteVerdicts().forClass(client, "Pkg.M", "edit");

    expect(verdict).toEqual({ ok: true });
  });

  it("swallows a failed capture", async () => {
    const client = makeClient({ sourceFileThrows: true });

    await expect(
      new WriteVerdicts().capture(client, "Pkg.M"),
    ).resolves.toBeUndefined();
  });
});

describe("WriteVerdicts.forDocument", () => {
  const SOURCE_DOC = docFor(vscode.Uri.parse("modelica-source:/Pkg.M.mo"));
  const FILE_DOC = docFor(vscode.Uri.file("/ws/Pkg/M.mo"));

  it("leaves a modelica-source document's verdict to the class", async () => {
    const stat = vi.spyOn(vscode.workspace.fs, "stat");
    try {
      const verdict = await new WriteVerdicts().forDocument(
        makeClient(),
        SOURCE_DOC,
        "Pkg.M",
        "edit",
      );

      expect(verdict).toEqual({ ok: true });
      // The listing has no mode of its own; statting it would only re-enter the
      // source provider and re-ask the question.
      expect(stat).not.toHaveBeenCalled();
    } finally {
      stat.mockRestore();
    }
  });

  it("refuses a file: document whose file mode is read-only", async () => {
    const stat = vi.spyOn(vscode.workspace.fs, "stat").mockResolvedValue({
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: 0,
      permissions: vscode.FilePermission.Readonly,
    });
    try {
      const verdict = await new WriteVerdicts().forDocument(
        makeClient(),
        FILE_DOC,
        "Pkg.M",
        "edit",
      );

      expect(verdict).toEqual({
        ok: false,
        reason: "Cannot edit Pkg.M — its source file is read-only.",
      });
    } finally {
      stat.mockRestore();
    }
  });

  it.each([
    ["writable", undefined],
    ["read-only", vscode.FilePermission.Readonly],
  ] as const)(
    "refuses a file: document opened on a system library, whatever its mode (%s)",
    async (_label, permissions) => {
      // "Reopen with Modelica Diagram" on an installed library's `.mo` reaches
      // the editors through a `file:` URI, and the install is user-writable —
      // but the refusal must hold whether or not the file is also chmod'ed
      // read-only.
      const stat = vi.spyOn(vscode.workspace.fs, "stat").mockResolvedValue({
        type: vscode.FileType.File,
        ctime: 0,
        mtime: 0,
        size: 0,
        ...(permissions === undefined ? {} : { permissions }),
      });
      try {
        const verdict = await new WriteVerdicts().forDocument(
          makeClient({ sourceFile: SYSTEM_FILE }),
          docFor(vscode.Uri.file(SYSTEM_FILE)),
          "Modelica.Blocks",
          "edit",
        );

        expect(verdict).toEqual({
          ok: false,
          reason:
            "Cannot edit Modelica.Blocks — it belongs to a read-only system library.",
        });
      } finally {
        stat.mockRestore();
      }
    },
  );

  it("treats a failed stat as writable", async () => {
    const stat = vi
      .spyOn(vscode.workspace.fs, "stat")
      .mockRejectedValue(new Error("gone"));
    try {
      const verdict = await new WriteVerdicts().forDocument(
        makeClient(),
        FILE_DOC,
        "Pkg.M",
        "edit",
      );

      expect(verdict).toEqual({ ok: true });
    } finally {
      stat.mockRestore();
    }
  });
});
