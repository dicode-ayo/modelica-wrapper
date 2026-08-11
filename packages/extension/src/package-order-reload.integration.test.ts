/**
 * What `loadFile` does to a package already in the symbol table, measured
 * rather than assumed: it re-derives the child order from `package.order`, and
 * it does not unload a member dropped from that file. `reorderPackage` deletes
 * before reloading on the opposite premise, so these pin what OMC actually
 * does — a claim mocks cannot answer.
 *
 * Auto-skips when OMC isn't on PATH; honours `OMC_INTEGRATION=0/1` the same way
 * the other integration suites do.
 */

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { OmcClient } from "@dicode/omc-client";

import { describeIf } from "../test-support/integration-gate.js";

describeIf("package.order reload against real OMC", () => {
  let client: OmcClient;
  let dir: string;
  let pkgFile: string;
  let orderFile: string;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "mw-order-"));
    const pkgDir = path.join(dir, "P");
    await fsp.mkdir(pkgDir);
    pkgFile = path.join(pkgDir, "package.mo");
    orderFile = path.join(pkgDir, "package.order");
    await fsp.writeFile(pkgFile, "within ;\npackage P\nend P;\n");
    await fsp.writeFile(
      path.join(pkgDir, "A.mo"),
      "within P;\nmodel A\nend A;\n",
    );
    await fsp.writeFile(
      path.join(pkgDir, "B.mo"),
      "within P;\nmodel B\nend B;\n",
    );
    await fsp.writeFile(orderFile, "A\nB\n");
  });

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  const childOrder = async (): Promise<string[]> =>
    (await client.getClassNames({ typeName: "P" })).classNames;

  it("re-derives the child order from package.order on a plain reload", async () => {
    expect((await client.loadFile({ fileName: pkgFile })).success).toBe(true);
    expect(await childOrder()).toEqual(["A", "B"]);

    await fsp.writeFile(orderFile, "B\nA\n");
    expect((await client.loadFile({ fileName: pkgFile })).success).toBe(true);

    expect(await childOrder()).toEqual(["B", "A"]);
  });

  it("keeps a member dropped from package.order, with or without a delete first", async () => {
    // Neither route unloads it: `loadFile` on package.mo takes the member's own
    // `.mo` regardless of what package.order lists. Removal is the file
    // watcher's business when the file itself goes, not this handler's.
    expect((await client.loadFile({ fileName: pkgFile })).success).toBe(true);
    await fsp.writeFile(orderFile, "A\n");
    expect((await client.loadFile({ fileName: pkgFile })).success).toBe(true);
    expect(await childOrder()).toEqual(["A", "B"]);

    expect((await client.deleteClass({ typeName: "P" })).success).toBe(true);
    expect((await client.loadFile({ fileName: pkgFile })).success).toBe(true);
    expect(await childOrder()).toEqual(["A", "B"]);
  });
  it("re-derives it after a delete too, so the delete costs the order nothing", async () => {
    expect((await client.loadFile({ fileName: pkgFile })).success).toBe(true);
    await fsp.writeFile(orderFile, "B\nA\n");

    expect((await client.deleteClass({ typeName: "P" })).success).toBe(true);
    expect((await client.loadFile({ fileName: pkgFile })).success).toBe(true);

    expect(await childOrder()).toEqual(["B", "A"]);
  });
});
