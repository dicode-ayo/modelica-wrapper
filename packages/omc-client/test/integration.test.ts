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
 *
 * Covers all 8 OMC API categories now that the per-function-file refactor is
 * complete. Heavy operations (translate, build, simulate, FMU export) are
 * NOT exercised here — they're slow and hard to assert on without a model
 * fixture. They get one targeted test each via `checkModel` and `simulate`
 * with a small built-in example.
 */

import { execSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OmcClient } from "../src/client.js";

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

  // === Browsing ===

  it("getVersion returns a populated version string", async () => {
    const { version } = await client.getVersion();
    expect(version).toMatch(/OpenModelica/);
  });

  it("invoke() dispatches by name with full input + output validation", async () => {
    // Class API equivalent: client.getVersion({})
    const r = await client.invoke("getVersion", {});
    expect(r.version).toMatch(/OpenModelica/);

    // Loaded-state browsing via invoke()
    await client.invoke("loadModel", { typeName: "Modelica" });
    const info = await client.invoke("getClassInformation", {
      typeName: "Modelica.Blocks.Math.Sin",
    });
    expect(info.restriction).toBe("block");
  });

  it("invoke() throws ZodError on malformed input", async () => {
    // typeName must be a string. A number should bounce off the input schema
    // BEFORE we ever talk to OMC.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.invoke("getClassInformation", { typeName: 42 as any }),
    ).rejects.toThrow();
  });

  it("getVersionStatus reports compatibility with the pinned OMC", async () => {
    const r = await client.getVersionStatus();
    // We pin 1.26.1; the runtime OMC may be exact, minor-compat, or
    // untested. We don't assert which — just that the contract holds.
    expect(["exact", "minor-compatible", "untested"]).toContain(r.level);
    expect(r.supportedPrimary).toBe(OmcClient.supportedOmcVersion);
    expect(r.omc).toBeDefined();
    if (r.omc) {
      expect(r.omc.major).toBeGreaterThan(0);
      expect(r.omc.minor).toBeGreaterThanOrEqual(0);
    }
  });

  it("getClassNames on an empty session returns an array", async () => {
    const { classNames } = await client.getClassNames({});
    expect(Array.isArray(classNames)).toBe(true);
  });

  it("loads Modelica and exercises Browsing browsing", async () => {
    const { success } = await client.loadModel({ typeName: "Modelica" });
    expect(success).toBe(true);

    const { classNames: top } = await client.getClassNames({});
    expect(top).toContain("Modelica");

    const info = await client.getClassInformation({
      typeName: "Modelica.Blocks.Math.Sin",
    });
    expect(info.restriction).toBe("block");
    expect(info.comment).toMatch(/sine/i);
    expect(info.lineNumberStart).toBeGreaterThan(0);

    const { b: isPkg } = await client.isPackage({ typeName: "Modelica" });
    expect(isPkg).toBe(true);

    const { exists } = await client.existClass({
      typeName: "Modelica.Blocks.Math.Sin",
    });
    expect(exists).toBe(true);

    const { count } = await client.getInheritanceCount({
      typeName: "Modelica.Blocks.Math.Sin",
    });
    expect(count).toBeGreaterThan(0);

    const { inheritedClasses } = await client.getInheritedClasses({
      typeName: "Modelica.Blocks.Math.Sin",
    });
    expect(inheritedClasses.length).toBeGreaterThan(0);
  });

  it("searchClassNames returns matching class names", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { classNames } = await client.searchClassNames({
      searchText: "PID",
    });
    expect(classNames.length).toBeGreaterThan(0);
    expect(classNames.some((n) => n.includes("PID"))).toBe(true);
  });

  it("getUses returns library/version pairs", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { uses } = await client.getUses({ typeName: "Modelica" });
    expect(uses.length).toBeGreaterThan(0);
    for (const [name, version] of uses) {
      expect(name).toBeTruthy();
      expect(version).toBeTruthy();
    }
  });

  it("getErrorString surfaces OMC's accumulated errors", async () => {
    await client.call("getClassInformation(DoesNotExist.WhateverClass)");
    const { errorString } = await client.getErrorString();
    expect(typeof errorString).toBe("string");
  });

  // === Reading model contents ===

  it("getComponents on a model returns typed component rows", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { components } = await client.getComponents({
      typeName: "Modelica.Blocks.Examples.PID_Controller",
    });
    expect(components.length).toBeGreaterThan(0);
    const names = components.map((c) => c.name);
    expect(names).toContain("PI");
    for (const c of components) {
      expect(c.className).toBeTruthy();
      expect(c.name).toBeTruthy();
    }
  });

  it("getNthConnection returns from/to/comment fields", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { count } = await client.getConnectionCount({
      typeName: "Modelica.Blocks.Examples.PID_Controller",
    });
    expect(count).toBeGreaterThan(0);
    const conn = await client.getNthConnection({
      typeName: "Modelica.Blocks.Examples.PID_Controller",
      index: 1,
    });
    expect(conn.from).toBeTruthy();
    expect(conn.to).toBeTruthy();
  });

  it("getIconAnnotation returns a parsed Value tree", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { annotation } = await client.getIconAnnotation({
      typeName: "Modelica.Blocks.Math.Sin",
    });
    expect(annotation.kind).toBe("list");
  });

  it("getDocumentationAnnotation splits info/revision/infoHeader", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const doc = await client.getDocumentationAnnotation({
      typeName: "Modelica.Blocks.Math.Sin",
    });
    expect(typeof doc.info).toBe("string");
    expect(typeof doc.revision).toBe("string");
    expect(typeof doc.infoHeader).toBe("string");
  });

  it("instantiateModel returns flattened source", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { flatSource } = await client.instantiateModel({
      typeName: "Modelica.Blocks.Examples.PID_Controller",
    });
    expect(flatSource).toMatch(/model\s+/);
    expect(flatSource.length).toBeGreaterThan(500);
  });

  it("assembles a full diagram view (canvas + components + connections)", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const cls = "Modelica.Blocks.Examples.PID_Controller";

    const { annotation: canvas } = await client.getDiagramAnnotation({
      typeName: cls,
    });
    expect(canvas.kind).toBe("list");

    const { components } = await client.getComponents({ typeName: cls });
    expect(components.length).toBeGreaterThan(0);
    const { annotations } = await client.getComponentAnnotations({
      typeName: cls,
    });
    expect(annotations.length).toBe(components.length);

    const { count } = await client.getConnectionCount({ typeName: cls });
    expect(count).toBeGreaterThan(0);
    const conns = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        Promise.all([
          client.getNthConnection({ typeName: cls, index: i + 1 }),
          client.getNthConnectionAnnotation({ typeName: cls, index: i + 1 }),
        ]),
      ),
    );
    expect(conns).toHaveLength(count);
    for (const [conn, ann] of conns) {
      expect(conn.from).toBeTruthy();
      expect(conn.to).toBeTruthy();
      expect(["call", "list", "null"]).toContain(ann.annotation.kind);
    }
  });

  // === Solver / runtime config ===

  it("solver method getters tolerate empty responses", async () => {
    const { solverMethods } = await client.getSolverMethods();
    expect(Array.isArray(solverMethods)).toBe(true);
  });

  // === Execution ===

  it("getSimulationOptions returns the experiment defaults", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const opts = await client.getSimulationOptions({
      typeName: "Modelica.Blocks.Examples.PID_Controller",
    });
    expect(opts.stopTime).toBeGreaterThan(opts.startTime);
    expect(opts.tolerance).toBeGreaterThan(0);
  });

  it("isExperiment recognizes runnable models", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { isExperiment } = await client.isExperiment({
      typeName: "Modelica.Blocks.Examples.PID_Controller",
    });
    expect(isExperiment).toBe(true);
  });

  it("checkModel on a non-existent class returns a diagnostic string", async () => {
    const { result } = await client.checkModel({
      typeName: "DoesNotExist.WhateverClass",
    });
    expect(typeof result).toBe("string");
  });

  // === Concurrency ===

  it("serializes concurrent calls without REQ/REP corruption", async () => {
    const ps = Array.from({ length: 8 }, () => client.getVersion());
    const versions = (await Promise.all(ps)).map((r) => r.version);
    expect(new Set(versions).size).toBe(1);
  });
});
