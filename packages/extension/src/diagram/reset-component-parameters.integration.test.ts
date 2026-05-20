/**
 * Integration test for the "Reset to defaults" clear (issue #30,
 * deferred half) against a real OMC install. The modal's reset handler
 * calls `clearComponentModifiers(client, className, componentName,
 * { keepRedeclares: true })` — this proves that exact call lands the
 * cleared OMC state on a typed sub-component carrying a value modifier.
 *
 * We import only `clearComponentModifiers` (vscode-free), never
 * `open-diagram.ts` — its `resetComponentParameters` wrapper pulls in
 * vscode, which isn't available in plain Node. The wrapper is otherwise
 * a thin REPL-log / toast shell over this same call (covered by the
 * unit test).
 *
 * Gating mirrors the omc-client suites: auto-runs when `omc` is on PATH
 * (or `OMC_PATH` / `OMC_INTEGRATION=1` is set); auto-skips otherwise.
 */

import { execSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OmcClient } from "@modelica-wrapper/omc-client";

import { clearComponentModifiers } from "./clear-modifiers.js";

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

describeIf("reset-to-defaults clear against real OMC", () => {
  let client: OmcClient;
  let pkg: string;
  let cls: string;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    const { randomBytes } = await import("node:crypto");
    pkg = `MwReset_${randomBytes(4).toString("hex")}`;
    cls = `${pkg}.Sample`;
    await client.loadModel({ typeName: "Modelica" });
    await client.loadString({
      data: `package ${pkg}
  model Sample
    Modelica.Blocks.Math.Gain gain(k=2.5);
    Real x;
  equation
    x = gain.y;
  end Sample;
end ${pkg};
`,
      filename: `<fixture:${pkg}>`,
    });
  });

  afterEach(async () => {
    await client.deleteClass({ typeName: pkg });
    await client.close();
  });

  it("clears gain.k via the reset call (keepRedeclares=true)", async () => {
    // Fixture binds `gain.k = 2.5`.
    const before = await client.getElementModifierValue({
      typeName: cls,
      modifier: "gain.k",
    });
    expect(before.value).toContain("2.5");

    // The exact call the modal's reset handler makes.
    const success = await clearComponentModifiers(client, cls, "gain", {
      keepRedeclares: true,
    });
    expect(success).toBe(true);
    expect(client.lastCall).toContain("removeElementModifiers");

    // After reset, the modifier is gone — the field would show the type
    // default the next time the modal re-opens.
    const after = await client.getElementModifierValue({
      typeName: cls,
      modifier: "gain.k",
    });
    expect(after.value).toBe("");
  });
});
