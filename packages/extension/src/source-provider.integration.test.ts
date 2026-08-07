/**
 * Integration test: saving one class stored inline in a multi-class `.mo`
 * file must preserve its siblings on disk.
 *
 * This pins the invariant the unit tests can only mock around — that loading a
 * member under its real source file keeps the other classes in OMC memory, so
 * the whole-file `listFile(owner)` written back is complete. Auto-skips when
 * OMC isn't on PATH; honours `OMC_INTEGRATION=0/1`.
 */

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { OmcClient } from "@dicode/omc-client";

import { describeIf } from "../test-support/integration-gate.js";
import { createSelfWriteGuard } from "./self-write-guard.js";
import { ModelicaSourceProvider, sourceUriFor } from "./source-provider.js";
import { WriteVerdicts } from "./write-verdict.js";

const MULTI_PKG = `package MultiPkg
  model A
    Real x = 1;
  end A;
  model B
    Real y = 2;
  end B;
end MultiPkg;
`;

describeIf("whole-file save preserves inline siblings", () => {
  let client: OmcClient;
  let dir: string;
  let pkgFile: string;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "src-int-"));
    pkgFile = path.join(dir, "MultiPkg.mo");
    await fsp.writeFile(pkgFile, MULTI_PKG, "utf8");
    const { success } = await client.loadFile({ fileName: pkgFile });
    if (!success) throw new Error("loadFile MultiPkg failed");
  });

  afterEach(async () => {
    await client.close();
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it("keeps sibling B on disk when member A is edited", async () => {
    const provider = new ModelicaSourceProvider(
      () => Promise.resolve(client),
      createSelfWriteGuard(),
      new WriteVerdicts(),
    );
    const uri = sourceUriFor("MultiPkg.A");

    const before = Buffer.from(await provider.readFile(uri)).toString("utf8");
    const edited = before.replace("= 1", "= 999");
    expect(edited).not.toBe(before);

    await provider.writeFile(uri, Buffer.from(edited, "utf8"));

    const onDisk = await fsp.readFile(pkgFile, "utf8");
    // A's edit landed…
    expect(onDisk).toContain("999");
    // …and B survived, rather than the file being truncated to just A.
    expect(onDisk).toMatch(/model B/);
    expect(onDisk).toMatch(/Real y = 2/);
  });
});
