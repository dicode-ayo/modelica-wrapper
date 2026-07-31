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

  it("reports the reloaded member's own line range against the file, not the string handed to loadString", async () => {
    // The load-bearing assumption behind `live-check.ts`'s sibling-diagnostic
    // fix (packages/extension/src/commands/live-check.ts): after a targeted
    // reload, does OMC still know a shared-file member's real position in
    // the file, or does it treat the reload as if `data` alone were now the
    // whole file (the member's start resets to line 1)? `getClassInformation`
    // is exactly the signal that fix reads, live, on every check — this pins
    // what it actually reports post-reload.
    const { packageName, packagePath, memberSource } =
      await loadInlinePackage();
    const before = await client.getClassInformation({
      typeName: `${packageName}.A`,
    });
    // `A` sits on the line right after `package …` in the fixture.
    expect(before.lineNumberStart).toBe(2);

    // `edited` starts with `model A` on its own first line — if OMC numbered
    // this reload's diagnostics relative to that string alone, the class's
    // reported start would now be line 1.
    const edited = memberSource.replace("Real x;", "Real x;\n  Real edited;");
    const { success } = await client.loadString({
      data: edited,
      filename: packagePath,
      merge: false,
    });
    expect(success).toBe(true);

    const after = await client.getClassInformation({
      typeName: `${packageName}.A`,
    });
    expect(after.lineNumberStart).toBe(before.lineNumberStart);
  });
});
