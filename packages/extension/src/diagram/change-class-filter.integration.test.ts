/**
 * Integration test for the "Change class" connection filter (issue #239)
 * against a real OMC install. The unit suite runs on fakes; this proves
 * the two OMC-shaped claims the design rests on hold against live OMC:
 *
 *  1. `resolveCandidatePorts` recovers ports that live on ancestor
 *     classes. `getElements` reports only locally-declared elements, so a
 *     `Resistor`'s `p`/`n` — three levels up on `TwoPin` — only appear
 *     once the extends chain is walked.
 *  2. The walk never hangs. `getModelInstance` never returns for the
 *     builtin `String` and costs seconds on deep models; `getElements`
 *     returns on both, which is the freeze (#268) this rework avoids.
 *
 * Gating mirrors the omc-client suites: auto-runs when `omc` is on PATH
 * (or `OMC_PATH` / `OMC_INTEGRATION=1` is set); auto-skips otherwise.
 */

import { execSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OmcClient } from "@dicode/omc-client";

import {
  filterCompatibleCandidates,
  resolveCandidatePorts,
  type PortMapCache,
} from "./change-class-filter.js";

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

const RESISTOR = "Modelica.Electrical.Analog.Basic.Resistor";
const CAPACITOR = "Modelica.Electrical.Analog.Basic.Capacitor";
const INDUCTOR = "Modelica.Electrical.Analog.Basic.Inductor";
const GROUND = "Modelica.Electrical.Analog.Basic.Ground";
const POSITIVE_PIN = "Modelica.Electrical.Analog.Interfaces.PositivePin";
const NEGATIVE_PIN = "Modelica.Electrical.Analog.Interfaces.NegativePin";

describeIf("change-class filter against real OMC", () => {
  let client: OmcClient;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    await client.loadModel({ typeName: "Modelica" });
  }, 60_000);

  afterEach(async () => {
    await client.close();
  });

  it("recovers inherited ports Resistor declares on no ancestor of its own", async () => {
    const ports = await resolveCandidatePorts(client, RESISTOR, new Map());
    expect(ports?.get("p")).toBe(POSITIVE_PIN);
    expect(ports?.get("n")).toBe(NEGATIVE_PIN);
  }, 30_000);

  it("keeps electrical two-pins as swap candidates for a connected Resistor, drops a Ground", async () => {
    const required = [
      { name: "p", typeName: POSITIVE_PIN },
      { name: "n", typeName: NEGATIVE_PIN },
    ];
    const cache: PortMapCache = new Map();
    const candidates = [
      { qualified: RESISTOR },
      { qualified: CAPACITOR },
      { qualified: INDUCTOR },
      { qualified: GROUND },
    ];
    const kept = await filterCompatibleCandidates(
      client,
      candidates,
      required,
      cache,
    );
    const names = kept.map((c) => c.qualified);
    expect(names).toContain(CAPACITOR);
    expect(names).toContain(INDUCTOR);
    // Ground has a single pin `p`, no `n` — it can't carry both connections.
    expect(names).not.toContain(GROUND);
  }, 60_000);

  it("returns rather than hangs on the builtin String and a deep model", async () => {
    // getModelInstance(String) never returns and the deep adder costs
    // ~12s to instantiate; getElements returns on both.
    const deep =
      "Modelica.Electrical.Spice3.Examples.Spice3BenchmarkFourBitBinaryAdder.FOURBIT";
    await expect(
      resolveCandidatePorts(client, "String", new Map()),
    ).resolves.not.toThrow();
    await expect(
      resolveCandidatePorts(client, deep, new Map()),
    ).resolves.toBeDefined();
  }, 60_000);
});
