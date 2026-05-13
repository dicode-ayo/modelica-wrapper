/**
 * Integration test: end-to-end OMC ↔ disk persistence.
 *
 * Validates that:
 *  1. `persistClassUnderWorkspace` + `linkPersistedClass` actually update
 *     OMC's symbol-table `fileName` to a real path.
 *  2. The on-disk artifacts we produce are self-sufficient: a *fresh* OMC
 *     instance can `loadFile` them and see the class come back. This is the
 *     guarantee that matters for the "next time you open the workspace,
 *     your model is still there" story.
 *
 * Auto-skips when OMC isn't on PATH; honours `OMC_INTEGRATION=0/1` overrides
 * the same way the omc-client integration suite does.
 */

import { execSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OmcClient } from "@modelica-wrapper/omc-client";

import {
  linkPersistedClass,
  persistClassUnderWorkspace,
} from "./persist.js";

function shouldRun(): boolean {
  const flag = process.env.OMC_INTEGRATION;
  if (flag === "0") return false;
  if (flag === "1") return true;
  if (process.env.OMC_PATH && process.env.OMC_PATH.length > 0) return true;
  try {
    execSync(process.platform === "win32" ? "where omc" : "command -v omc", {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

const describeIf = shouldRun() ? describe : describe.skip;

/**
 * Run a sequence of `loadString` calls, one class at a time. OMC requires
 * each `within X.Y;` parent to already be in the symbol table, so a deeply
 * nested class can't be declared in one shot — this mirrors the real
 * `createClass` flow where the user makes each package level individually.
 */
async function loadStepwise(
  client: OmcClient,
  steps: Array<[typeName: string, data: string]>,
): Promise<void> {
  for (const [typeName, data] of steps) {
    const { success } = await client.loadString({
      data,
      filename: `<runtime:${typeName}>`,
      merge: true,
    });
    if (!success) {
      const { errorString } = await client.getErrorString();
      throw new Error(`loadString failed for ${typeName}: ${errorString}`);
    }
  }
}

describeIf("persist + OMC roundtrip", () => {
  let client: OmcClient;
  let ws: string;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    ws = await fsp.mkdtemp(path.join(os.tmpdir(), "persist-int-"));
  });

  afterEach(async () => {
    await client.close();
    await fsp.rm(ws, { recursive: true, force: true });
  });

  it("persists a flat class and OMC's fileName reflects the disk path", async () => {
    // Create the class via loadString — same path createClass takes. OMC's
    // fileName starts as the pseudo `<runtime:…>`, which is what triggers
    // the disk-materialization branch.
    const src = "model RoundtripFlat\nend RoundtripFlat;\n";
    const { success } = await client.loadString({
      data: src,
      filename: "<runtime:RoundtripFlat>",
      merge: true,
    });
    expect(success).toBe(true);

    const before = await client.getClassInformation({
      typeName: "RoundtripFlat",
    });
    expect(before.fileName).toBe("<runtime:RoundtripFlat>");

    const result = await persistClassUnderWorkspace(
      client,
      ws,
      "RoundtripFlat",
      src,
    );
    await linkPersistedClass(client, "RoundtripFlat", result);

    // Disk artifact exists at the expected location.
    expect(result.leafPath).toBe(path.join(ws, "RoundtripFlat.mo"));
    expect(await fsp.readFile(result.leafPath, "utf8")).toBe(src);

    // OMC's symbol table now points at the disk file.
    const after = await client.getClassInformation({
      typeName: "RoundtripFlat",
    });
    expect(after.fileName).toBe(result.leafPath);
  });

  it("persists a nested class and writes package.mo at each level", async () => {
    // Real createClass flow: parents are made stepwise via loadString. OMC
    // requires each `within …;` target to already exist, so we can't
    // declare a 3-level class in one shot.
    await loadStepwise(client, [
      ["RoundtripPkg", "package RoundtripPkg\nend RoundtripPkg;\n"],
      [
        "RoundtripPkg.Sub",
        "within RoundtripPkg;\npackage Sub\nend Sub;\n",
      ],
      [
        "RoundtripPkg.Sub.Model",
        "within RoundtripPkg.Sub;\nblock Model\nend Model;\n",
      ],
    ]);
    const src = "within RoundtripPkg.Sub;\nblock Model\nend Model;\n";
    const result = await persistClassUnderWorkspace(
      client,
      ws,
      "RoundtripPkg.Sub.Model",
      src,
    );
    await linkPersistedClass(client, "RoundtripPkg.Sub.Model", result);

    // Both parent package.mo files were created under the workspace root.
    const topPkg = path.join(ws, "RoundtripPkg", "package.mo");
    const subPkg = path.join(ws, "RoundtripPkg", "Sub", "package.mo");
    expect(result.newParents.map((p) => p.pkgFile)).toEqual([topPkg, subPkg]);
    await fsp.access(topPkg);
    await fsp.access(subPkg);
    await fsp.access(result.leafPath);

    // OMC's symbol table updated for every level we touched.
    expect(
      (await client.getClassInformation({ typeName: "RoundtripPkg" })).fileName,
    ).toBe(topPkg);
    expect(
      (await client.getClassInformation({ typeName: "RoundtripPkg.Sub" })).fileName,
    ).toBe(subPkg);
    expect(
      (await client.getClassInformation({
        typeName: "RoundtripPkg.Sub.Model",
      })).fileName,
    ).toBe(result.leafPath);
  });

  it("a fresh OMC can loadFile the persisted package and see the class", async () => {
    // The whole point: artifacts on disk must be self-sufficient. We
    // persist with one OMC instance, throw it away, then spin up a fresh
    // instance and ask it to load just the top-level package.mo. If our
    // package.mo + leaf .mo are valid Modelica, the class should reappear.
    await loadStepwise(client, [
      ["Roundtrip2", "package Roundtrip2\nend Roundtrip2;\n"],
      ["Roundtrip2.Sub", "within Roundtrip2;\npackage Sub\nend Sub;\n"],
      [
        "Roundtrip2.Sub.Reloaded",
        "within Roundtrip2.Sub;\nmodel Reloaded\nend Reloaded;\n",
      ],
    ]);
    const src = "within Roundtrip2.Sub;\nmodel Reloaded\nend Reloaded;\n";
    const result = await persistClassUnderWorkspace(
      client,
      ws,
      "Roundtrip2.Sub.Reloaded",
      src,
    );
    await linkPersistedClass(client, "Roundtrip2.Sub.Reloaded", result);
    await client.close();

    // Fresh process — nothing about Roundtrip2 is loaded here yet.
    const fresh = await OmcClient.create({
      omcPath: process.env.OMC_PATH ?? "",
    });
    try {
      const { success } = await fresh.loadFile({
        fileName: path.join(ws, "Roundtrip2", "package.mo"),
      });
      expect(success).toBe(true);
      const info = await fresh.getClassInformation({
        typeName: "Roundtrip2.Sub.Reloaded",
      });
      expect(info.restriction).toBe("model");
      // The disk path inside info.fileName should match what we wrote.
      expect(info.fileName).toBe(result.leafPath);
    } finally {
      // afterEach will also call client.close() — already done above and
      // OmcClient.close() is idempotent, so the second call is a no-op.
      await fresh.close();
    }
  });
});
