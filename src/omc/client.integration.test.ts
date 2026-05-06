/**
 * Integration tests against a real OMC install.
 *
 * Auto-runs whenever `omc` is on PATH or `OMC_PATH` points to a binary.
 * Skips cleanly if no OMC is available, so the suite stays green on
 * machines without OpenModelica installed (CI, contributors, etc.).
 *
 * Override:
 *   OMC_INTEGRATION=0  force skip
 *   OMC_INTEGRATION=1  force run (missing OMC then becomes a real failure)
 */

import { execSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OmcClient } from "./client.js";

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

  it("instantiateModel returns flattened Modelica source", async () => {
    await client.loadModel("Modelica");
    const flat = await client.instantiateModel(
      "Modelica.Blocks.Examples.PID_Controller",
    );
    // Post-elaboration source: should declare the top-level "model" and at
    // least one inlined sub-component.
    expect(flat).toMatch(/model\s+/);
    expect(flat.length).toBeGreaterThan(500);
  });

  it("assembles a full diagram view (canvas + components + connections)", async () => {
    // Gathers everything the diagram canvas would need for one class:
    //   - canvas extents/grid via getDiagramAnnotation
    //   - sub-components and their placement annotations
    //   - all connections with their line annotations
    // No flattening across inheritance here — that's a separate composition.
    await client.loadModel("Modelica");
    const clazz = "Modelica.Blocks.Examples.PID_Controller";

    const canvas = await client.getDiagramAnnotation(clazz);
    expect(canvas.kind).toBe("list"); // {x1,y1,x2,y2,gridVisible,...,{shapes}}

    const components = await client.getComponents(clazz);
    expect(components.length).toBeGreaterThan(0);
    const placements = await client.getComponentAnnotations(clazz);
    expect(placements.length).toBe(components.length);

    const count = await client.getConnectionCount(clazz);
    expect(count).toBeGreaterThan(0);
    const connections = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        Promise.all([
          client.getNthConnection(clazz, i + 1),
          client.getNthConnectionAnnotation(clazz, i + 1),
        ]),
      ),
    );
    expect(connections).toHaveLength(count);
    for (const [conn, ann] of connections) {
      expect(conn.from).toBeTruthy();
      expect(conn.to).toBeTruthy();
      // Connection annotations are typically Line(...) calls or null.
      expect(["call", "list", "null"]).toContain(ann.kind);
    }

    // Sanity: at least one well-known sub-component exists.
    const names = components.map((c) => c.name);
    expect(names).toContain("PI");
  });

  it("rejects an unknown command gracefully via error string", async () => {
    // checkModel on a missing class returns a diagnostic string, not throw.
    const result = await client.checkModel("DoesNotExist.WhateverClass");
    expect(typeof result).toBe("string");
  });
});
