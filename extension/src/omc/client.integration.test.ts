/**
 * Integration tests against a real OMC install.
 *
 * Run with:
 *
 *     OMC_INTEGRATION=1 npx vitest run src/omc/client.integration.test.ts
 *
 * or via the npm script `npm run test:integration`.
 *
 * Skipped by default so `npm test` stays fast and offline-friendly.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OmcClient } from "./client.js";

const enabled = process.env.OMC_INTEGRATION === "1";
const describeIf = enabled ? describe : describe.skip;

describeIf("OmcClient against real OMC", () => {
  let client: OmcClient;

  beforeEach(async () => {
    client = await OmcClient.create({
      omcPath: process.env.OMC_PATH ?? "",
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it("returns OMC version", async () => {
    const v = await client.getVersion();
    expect(v).toMatch(/OpenModelica/);
  });

  it("lists empty top-level when nothing loaded", async () => {
    const names = await client.getClassNames("");
    expect(Array.isArray(names)).toBe(true);
  });

  it("loads Modelica library and browses it", async () => {
    const ok = await client.loadModel("Modelica");
    expect(ok).toBe(true);

    const top = await client.getClassNames("");
    expect(top).toContain("Modelica");

    const info = await client.getClassInformation("Modelica.Blocks.Math.Sin");
    expect(info.restriction).toBe("block");
    expect(info.comment).toMatch(/sine/i);
    expect(info.lineStart).toBeGreaterThan(0);

    const isPkg = await client.isPackage("Modelica");
    expect(isPkg).toBe(true);

    const inherited = await client.getInheritedClasses("Modelica.Blocks.Math.Sin");
    expect(inherited.length).toBeGreaterThan(0);
  });

  it("returns a parsed icon annotation Value tree", async () => {
    await client.loadModel("Modelica");
    const icon = await client.getIconAnnotation("Modelica.Blocks.Math.Sin");
    expect(icon.kind).toBe("list");
  });

  it("getNthConnection returns a typed Connection", async () => {
    await client.loadModel("Modelica");
    const count = await client.getConnectionCount(
      "Modelica.Blocks.Examples.PID_Controller",
    );
    expect(count).toBeGreaterThan(0);
    const conn = await client.getNthConnection(
      "Modelica.Blocks.Examples.PID_Controller",
      1,
    );
    expect(conn.from.length).toBeGreaterThan(0);
    expect(conn.to.length).toBeGreaterThan(0);
  });

  it("returns library uses as pairs", async () => {
    await client.loadModel("Modelica");
    const uses = await client.getUses("Modelica");
    expect(uses.length).toBeGreaterThan(0);
    for (const [name, version] of uses) {
      expect(name).toBeTruthy();
      expect(version).toBeTruthy();
    }
  });

  it("getSimulationOptions returns a 5-tuple", async () => {
    await client.loadModel("Modelica");
    const opts = await client.getSimulationOptions(
      "Modelica.Blocks.Examples.PID_Controller",
    );
    expect(opts.stopTime).toBeGreaterThan(opts.startTime);
    expect(opts.tolerance).toBeGreaterThan(0);
  });

  it("solver method getters tolerate empty responses", async () => {
    // OMC 1.26 returns null for these in interactive context — should resolve to [].
    const m = await client.getSolverMethods();
    expect(Array.isArray(m)).toBe(true);
  });

  it("serializes concurrent calls without REQ/REP corruption", async () => {
    const ps = Array.from({ length: 8 }, () => client.getVersion());
    const versions = await Promise.all(ps);
    expect(new Set(versions).size).toBe(1);
  });

  it("rejects an unknown command gracefully via error string", async () => {
    // checkModel on a missing class returns a diagnostic string, not throw.
    const result = await client.checkModel("DoesNotExist.WhateverClass");
    expect(typeof result).toBe("string");
  });
});
