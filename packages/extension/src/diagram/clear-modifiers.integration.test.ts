/**
 * Integration test for the bulk-clear helper against a real OMC install
 * (issue #30). Proves `clearComponentModifiers` lands the same OMC state
 * as the per-field clear path — every modifier on the sub-component gone —
 * in ONE `removeElementModifiers` RPC.
 *
 * Gating mirrors the omc-client suites: auto-runs when `omc` is on PATH
 * (or `OMC_PATH` / `OMC_INTEGRATION=1` is set); auto-skips otherwise.
 *
 * Imports only the vscode-free helper + the real `OmcClient` — never
 * `open-diagram.ts` (which pulls in vscode), so this runs in plain Node.
 */

import { execSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OmcClient } from "@dicode/omc-client";

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

describeIf("clearComponentModifiers against real OMC", () => {
  let client: OmcClient;
  let pkg: string;
  let cls: string;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    const { randomBytes } = await import("node:crypto");
    pkg = `MwClear_${randomBytes(4).toString("hex")}`;
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

  it("bulk-clears a sub-component's modifiers in one RPC", async () => {
    // Sanity: the fixture binds `gain.k = 2.5`.
    const before = await client.getElementModifierValue({
      typeName: cls,
      modifier: "gain.k",
    });
    expect(before.value).toContain("2.5");

    const success = await clearComponentModifiers(client, cls, "gain");
    expect(success).toBe(true);

    // The single helper call should be the one we just made.
    expect(client.lastCall).toContain("removeElementModifiers");

    // After clearing, gain.k's modifier value should be empty — same
    // end-state the per-field `setElementModifierValue(..., "")` loop
    // would have produced.
    const after = await client.getElementModifierValue({
      typeName: cls,
      modifier: "gain.k",
    });
    expect(after.value).toBe("");
  });
});
