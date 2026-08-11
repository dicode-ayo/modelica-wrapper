/**
 * `loadString`'s `filename` binds the loaded class to a file in OMC's symbol
 * table — it is not a diagnostics label. These pin both directions against a
 * real OMC, because every save/reload path in the extension depends on it:
 *
 *   1. Reloading one member of a single-file package under that package's real
 *      path updates it in place and leaves its siblings loaded.
 *   2. Reloading the same member under a per-class pseudo-filename evicts it
 *      from the package, which is what drops siblings on the next save.
 *
 * Gating mirrors the other integration tests: `OMC_INTEGRATION=0` forces skip,
 * `OMC_INTEGRATION=1` forces run.
 */

import { randomBytes } from "node:crypto";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import type { ErrorMessage } from "../src/index.js";
import { OmcClient } from "../src/client.js";
import { describeIf } from "./fixtures.js";

describeIf("loadString filename binding (live OMC)", () => {
  let client: OmcClient;
  let tmpDir: string;

  /**
   * A single-file package holding two inline members, loaded from disk. Returns
   * the package name, its `package.mo` path, and the source text of member `A`
   * as OMC re-serializes it — what an editor buffer on `A` would contain.
   */
  async function loadInlinePackage(): Promise<{
    packageName: string;
    packagePath: string;
    memberSource: string;
  }> {
    const packageName = `MwTest_${randomBytes(4).toString("hex")}`;
    const packagePath = path.join(tmpDir, `${packageName}.mo`);
    await fsp.writeFile(
      packagePath,
      `package ${packageName}
  model A
    Real x;
  end A;

  model B
    Real y;
  end B;
end ${packageName};
`,
      "utf8",
    );
    const { success } = await client.loadFile({ fileName: packagePath });
    if (!success) {
      const { errorString } = await client.getErrorString();
      throw new Error(`loadFile failed for ${packagePath}: ${errorString}`);
    }
    const { contents } = await client.listFile({
      typeName: `${packageName}.A`,
    });
    return { packageName, packagePath, memberSource: contents };
  }

  /**
   * A single-file package whose second member depends on its first. `Ahead`
   * carries an error, so checking `Target` surfaces a diagnostic belonging to
   * a class the buffer does not contain; `breakTarget` moves the error into
   * `Target` itself instead. Returns `Target`'s source as an editor buffer
   * would hold it.
   */
  async function loadSiblingPackage({ breakTarget = false } = {}): Promise<{
    packageName: string;
    packagePath: string;
    memberSource: string;
  }> {
    const packageName = `MwTest_${randomBytes(4).toString("hex")}`;
    const packagePath = path.join(tmpDir, `${packageName}.mo`);
    await fsp.writeFile(
      packagePath,
      `package ${packageName}
  model Ahead
    Real bad = ${breakTarget ? "1.0" : "notDefinedAnywhere"};
  end Ahead;

  model Target
    Ahead a;
    Real x${breakTarget ? " = alsoNotDefined" : ""};
  end Target;
end ${packageName};
`,
      "utf8",
    );
    const { success } = await client.loadFile({ fileName: packagePath });
    if (!success) {
      const { errorString } = await client.getErrorString();
      throw new Error(`loadFile failed for ${packagePath}: ${errorString}`);
    }
    const { contents } = await client.listFile({
      typeName: `${packageName}.Target`,
    });
    return { packageName, packagePath, memberSource: contents };
  }

  /**
   * `checkModel` stops at the first failure, so a fixture with one error
   * yields one message.
   */
  async function onlyMessageFrom(typeName: string): Promise<ErrorMessage> {
    await client.checkModel({ typeName });
    const { messages } = await client.getMessagesStringInternal();
    const [message] = messages;
    if (message === undefined) {
      throw new Error(`checkModel(${typeName}) reported no diagnostic`);
    }
    return message;
  }

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    await client.getErrorString();
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "mw-loadstring-"));
  });

  afterEach(async () => {
    await client.close();
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it("updates a member in place in its package's file when reloaded under it", async () => {
    const { packageName, packagePath, memberSource } =
      await loadInlinePackage();
    // Reloading the text unchanged would pass even if the load silently did
    // nothing, so carry an edit through and look for it in the file.
    const edited = memberSource.replace("Real x;", "Real x;\n  Real edited;");
    expect(edited).not.toBe(memberSource);

    const { success } = await client.loadString({
      data: edited,
      filename: packagePath,
      merge: false,
    });
    expect(success).toBe(true);

    const { contents } = await client.listFile({ typeName: packageName });
    expect(contents).toContain("Real edited");
    expect(contents).toContain("model B");
    const { fileName } = await client.getSourceFile({
      typeName: `${packageName}.A`,
    });
    expect(fileName).toBe(packagePath);
  });

  it("evicts a member from its package's file when reloaded under a per-class filename", async () => {
    const { packageName, memberSource } = await loadInlinePackage();
    const pseudoFilename = `modelica-source:/${packageName}.A.mo`;
    const edited = memberSource.replace("Real x;", "Real x;\n  Real edited;");

    const { success } = await client.loadString({
      data: edited,
      filename: pseudoFilename,
      merge: false,
    });
    expect(success).toBe(true);

    // `A` stays in the package's namespace, so `getClassNames` still lists it
    // and nothing looks wrong — but it is gone from the file, and a save writes
    // the file listing.
    const { classNames } = await client.getClassNames({
      typeName: packageName,
    });
    expect(classNames).toContain("A");

    const { contents } = await client.listFile({ typeName: packageName });
    expect(contents).not.toContain("model A");
    expect(contents).toContain("model B");
    const { fileName } = await client.getSourceFile({
      typeName: `${packageName}.A`,
    });
    expect(fileName).toBe(pseudoFilename);
  });

  it("numbers a reloaded member inside the string it was given, and its siblings inside the file", async () => {
    // `live-check` reads `getClassInformation` to decide which of a shared
    // file's diagnostics belong to the buffer, so which space each class is
    // numbered in after a targeted reload is the whole basis of that decision.
    const { packageName, packagePath, memberSource } =
      await loadSiblingPackage();
    const before = await client.getClassInformation({
      typeName: `${packageName}.Target`,
    });
    expect(before.lineNumberStart).toBe(6);

    // `listFile` hands back a `within` clause, two lines ahead of the class.
    const { success } = await client.loadString({
      data: memberSource,
      filename: packagePath,
      merge: false,
    });
    expect(success).toBe(true);

    const target = await client.getClassInformation({
      typeName: `${packageName}.Target`,
    });
    expect(target.lineNumberStart).toBe(3);
    const ahead = await client.getClassInformation({
      typeName: `${packageName}.Ahead`,
    });
    expect(ahead.lineNumberStart).toBe(2);
  });

  it("lands a sibling's diagnostic inside the member's own reported extent", async () => {
    // The two spaces above overlap, and `ErrorMessage.info` names a filename
    // rather than the class it belongs to: a sibling declared ahead reports a
    // line that is also one of the buffer's own. Reloading the whole file is
    // what pulls them apart.
    const { packageName, packagePath, memberSource } =
      await loadSiblingPackage();
    await client.loadString({
      data: memberSource,
      filename: packagePath,
      merge: false,
    });
    await client.getErrorString();

    const aliased = await onlyMessageFrom(`${packageName}.Target`);
    const inString = await client.getClassInformation({
      typeName: `${packageName}.Target`,
    });
    expect(aliased.message).toContain("Ahead");
    expect(aliased.info.lineStart).toBeGreaterThanOrEqual(
      inString.lineNumberStart,
    );
    expect(aliased.info.lineStart).toBeLessThanOrEqual(inString.lineNumberEnd);

    const { contents } = await client.listFile({ typeName: packageName });
    const { success } = await client.loadString({
      data: contents,
      filename: packagePath,
      merge: false,
    });
    expect(success).toBe(true);
    await client.getErrorString();

    const separated = await onlyMessageFrom(`${packageName}.Target`);
    const inFile = await client.getClassInformation({
      typeName: `${packageName}.Target`,
    });
    expect(separated.info.lineStart).toBeLessThan(inFile.lineNumberStart);
  });

  it("moves the member's own diagnostic by the same offset as its extent", async () => {
    // `live-check` derives its shift from the class's extent and applies it to
    // the diagnostics; that only holds if both move together, in column as
    // well as line.
    const { packageName, packagePath, memberSource } = await loadSiblingPackage(
      { breakTarget: true },
    );
    await client.loadString({
      data: memberSource,
      filename: packagePath,
      merge: false,
    });
    await client.getErrorString();
    const inBuffer = await client.getClassInformation({
      typeName: `${packageName}.Target`,
    });
    const bufferDiagnostic = await onlyMessageFrom(`${packageName}.Target`);

    const { contents } = await client.listFile({ typeName: packageName });
    await client.loadString({
      data: contents,
      filename: packagePath,
      merge: false,
    });
    await client.getErrorString();
    const inFile = await client.getClassInformation({
      typeName: `${packageName}.Target`,
    });
    const fileDiagnostic = await onlyMessageFrom(`${packageName}.Target`);

    expect(
      fileDiagnostic.info.lineStart - bufferDiagnostic.info.lineStart,
    ).toBe(inFile.lineNumberStart - inBuffer.lineNumberStart);
    expect(
      fileDiagnostic.info.columnStart - bufferDiagnostic.info.columnStart,
    ).toBe(inFile.columnNumberStart - inBuffer.columnNumberStart);
  });
});
