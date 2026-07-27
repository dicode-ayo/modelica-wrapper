/**
 * Integration test for `fetchComponentClass` against a real OMC install: the
 * placement-preview resolve must carry a class's icon, coordinate system, and
 * ports so the preview node draws without a second fetch.
 *
 * Gating mirrors the omc-client suites: auto-runs when `omc` is on PATH (or
 * `OMC_PATH` / `OMC_INTEGRATION=1` is set); auto-skips otherwise. `vscode` is
 * aliased to a mock by the extension's vitest config, so importing
 * `open-diagram.ts` runs in plain Node.
 */

import { afterEach, beforeEach, expect, it } from "vitest";

import { OmcClient } from "@dicode/omc-client";

import { describeIf } from "../../test-support/integration-gate.js";
import { fetchComponentClass } from "./open-diagram.js";

describeIf("fetchComponentClass against real OMC", () => {
  let client: OmcClient;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    await client.loadModel({ typeName: "Modelica" });
  }, 60_000);

  afterEach(async () => {
    await client.close();
  });

  it("resolves a block's icon, coordinate system, and ports", async () => {
    const def = await fetchComponentClass(client, "Modelica.Blocks.Math.Gain");

    expect(def?.name).toBe("Modelica.Blocks.Math.Gain");
    expect(def?.iconLayers.length).toBeGreaterThan(0);
    expect(def?.coordinateSystem).toBeDefined();
    expect(Object.keys(def?.connectors ?? {}).sort()).toEqual(["u", "y"]);
  });

  it("resolves a two-pin connector class", async () => {
    const def = await fetchComponentClass(
      client,
      "Modelica.Electrical.Analog.Basic.Resistor",
    );

    // p, n, plus an optional heatPort — the class carries the conditional port.
    const ports = Object.keys(def?.connectors ?? {});
    expect(ports).toContain("p");
    expect(ports).toContain("n");
  });

  it("returns undefined for a class OMC can't instantiate", async () => {
    const def = await fetchComponentClass(client, "Nonexistent.Class.Xyz");

    expect(def).toBeUndefined();
  });
});
