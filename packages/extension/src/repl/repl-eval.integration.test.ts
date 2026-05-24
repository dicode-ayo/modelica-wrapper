/**
 * Integration test: REPL evaluator against a real OMC subprocess.
 *
 * Gated on `OMC_INTEGRATION=1` / `OMC_PATH=…` / `omc` on PATH the same way
 * the rest of the integration suite is. Verifies that the meta-command
 * helpers and the bare-call path agree with a live OMC.
 */

import { execSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OmcClient } from "@dicode/omc-client";

import { evalLine, type ReplDependencies } from "./repl-eval.js";

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

describeIf("REPL evaluator — live OMC", () => {
  let client: OmcClient;
  let tmp: string;
  let deps: ReplDependencies;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "repl-int-"));
    deps = {
      ensureClient: async () => client,
      resetClient: async () => {
        await client.close();
        client = await OmcClient.create({
          omcPath: process.env.OMC_PATH ?? "",
        });
        return client;
      },
    };
  });

  afterEach(async () => {
    await client.close().catch(() => undefined);
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("getVersion() returns a non-empty OpenModelica banner", async () => {
    const r = await evalLine("getVersion()", deps);
    expect(r.isError).toBe(false);
    expect(r.output).toContain("OpenModelica");
  });

  it("1 + 1 evaluates to 2", async () => {
    const r = await evalLine("1 + 1", deps);
    expect(r.isError).toBe(false);
    // OMC returns "2" (or "2\n"); evalLine strips the trailing newline.
    expect(r.output.trim()).toBe("2");
  });

  it("getClassNames() returns a parseable list", async () => {
    const r = await evalLine("getClassNames()", deps);
    expect(r.isError).toBe(false);
    // The empty workspace returns "{}" — still a valid OMC list literal.
    expect(r.output.trim().startsWith("{")).toBe(true);
    expect(r.output.trim().endsWith("}")).toBe(true);
  });

  it(":load on a missing path produces an error result", async () => {
    const r = await evalLine(":load /nonexistent-12345.mo", deps);
    expect(r.isError).toBe(true);
    expect(r.output.toLowerCase()).toContain("loadfile");
  });

  it(":load on a real file then a follow-up call sees the new class", async () => {
    const filePath = path.join(tmp, "Hello.mo");
    await fsp.writeFile(filePath, "model Hello\nend Hello;\n", "utf8");
    const r = await evalLine(`:load ${filePath}`, deps);
    expect(r.isError).toBe(false);
    expect(r.output).toBe("loaded");

    const after = await evalLine("getClassNames()", deps);
    expect(after.isError).toBe(false);
    expect(after.output).toContain("Hello");
  });

  it(":reset wipes OMC state and a follow-up call still works", async () => {
    // Load a class, prove it's there, reset, prove it's gone but OMC works.
    const filePath = path.join(tmp, "Ephemeral.mo");
    await fsp.writeFile(filePath, "model Ephemeral\nend Ephemeral;\n", "utf8");
    expect((await evalLine(`:load ${filePath}`, deps)).isError).toBe(false);
    const beforeReset = await evalLine("getClassNames()", deps);
    expect(beforeReset.output).toContain("Ephemeral");

    const reset = await evalLine(":reset", deps);
    expect(reset.isError).toBe(false);

    const afterReset = await evalLine("getClassNames()", deps);
    expect(afterReset.isError).toBe(false);
    expect(afterReset.output).not.toContain("Ephemeral");

    const v = await evalLine("getVersion()", deps);
    expect(v.isError).toBe(false);
    expect(v.output).toContain("OpenModelica");
  });
});
