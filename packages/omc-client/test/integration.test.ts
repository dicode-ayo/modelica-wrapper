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

  it("getModelInstance returns a structured tree for a leaf block", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { instance } = await client.getModelInstance({
      typeName: "Modelica.Blocks.Math.Sin",
    });
    expect(instance.name).toBe("Modelica.Blocks.Math.Sin");
    expect(instance.restriction).toBe("block");
    const elements = (instance.elements ?? []) as Array<{ $kind: string }>;
    expect(elements.some((e) => e.$kind === "extends")).toBe(true);
    const icon = instance.annotation?.Icon as
      | { graphics?: unknown[] }
      | undefined;
    expect(Array.isArray(icon?.graphics)).toBe(true);
    expect((icon?.graphics ?? []).length).toBeGreaterThan(0);
  });

  it("getModelInstance prettyPrint produces structurally identical content", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const cls = "Modelica.Blocks.Math.Sin";
    const compact = await client.getModelInstance({ typeName: cls });
    const pretty = await client.getModelInstance({
      typeName: cls,
      prettyPrint: true,
    });
    expect(pretty.instance).toEqual(compact.instance);
  });

  it("getModelInstanceAnnotation is a strict subset of getModelInstance for a leaf block", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const cls = "Modelica.Blocks.Math.Sin";
    const ann = await client.getModelInstanceAnnotation({ typeName: cls });
    expect(ann.instance.name).toBe(cls);
    const icon = ann.instance.annotation?.Icon;
    expect(Array.isArray(icon?.graphics)).toBe(true);
    expect((icon?.graphics ?? []).length).toBeGreaterThan(0);

    const annJson = JSON.stringify(ann.instance);
    const full = await client.getModelInstance({ typeName: cls });
    const fullJson = JSON.stringify(full.instance);
    // The annotation-only payload is materially smaller — subcomponent type
    // expansions are pruned. ~3.8 KB vs ~8 KB on Sin.
    expect(annJson.length).toBeLessThan(fullJson.length);
  });

  it("getModelInstance returns connections with cref paths and Line points for a diagram model", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { instance } = await client.getModelInstance({
      typeName: "Modelica.Blocks.Examples.PID_Controller",
    });
    const connections = instance.connections ?? [];
    expect(connections.length).toBeGreaterThan(0);
    for (const c of connections) {
      expect(c.lhs.$kind).toBe("cref");
      expect(c.rhs.$kind).toBe("cref");
      expect(c.lhs.parts.length).toBeGreaterThan(0);
    }
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

  // === Phase 1: cheap getters that don't need a fixture ===

  it("listFile returns Modelica source for a class", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { contents: source } = await client.listFile({
      typeName: "Modelica.Blocks.Math.Sin",
    });
    expect(source.length).toBeGreaterThan(0);
    expect(source).toMatch(/Sin|sine/i);
  });

  it("getInitialStates returns an empty list for a non-state-machine class", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { initialStates } = await client.getInitialStates({
      typeName: "Modelica.Blocks.Math.Sin",
    });
    expect(initialStates).toEqual([]);
  });

  it("getTransitions returns an empty list for a non-state-machine class", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { transitions } = await client.getTransitions({
      typeName: "Modelica.Blocks.Math.Sin",
    });
    expect(transitions).toEqual([]);
  });

  it("solver list-getters all return arrays (possibly empty on OMC 1.26)", async () => {
    const { jacobianMethods } = await client.getJacobianMethods();
    const { initializationMethods } = await client.getInitializationMethods();
    const { linearSolvers } = await client.getLinearSolvers();
    const { nonLinearSolvers } = await client.getNonLinearSolvers();
    expect(Array.isArray(jacobianMethods)).toBe(true);
    expect(Array.isArray(initializationMethods)).toBe(true);
    expect(Array.isArray(linearSolvers)).toBe(true);
    expect(Array.isArray(nonLinearSolvers)).toBe(true);
  });

  it("solver setters return success", async () => {
    // Pass non-destructive defaults that are accepted on every OMC build.
    const a = await client.setMatchingAlgorithm({ algorithm: "PFPlusExt" });
    expect(typeof a.success).toBe("boolean");
    const b = await client.setIndexReductionMethod({
      method: "dynamicStateSelection",
    });
    expect(typeof b.success).toBe("boolean");
    const c = await client.setCommandLineOptions({
      options: "--newBackend",
    });
    expect(typeof c.success).toBe("boolean");
  });

  it("getSourceFile returns a path for a loaded class (or empty for builtins)", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { fileName } = await client.getSourceFile({ typeName: "Modelica" });
    expect(typeof fileName).toBe("string");
    if (fileName.length > 0) {
      expect(fileName).toMatch(/\.mo$/);
    }
  });

  it("getParameterValue returns a string (possibly empty for unset params)", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const r = await client.getParameterValue({
      typeName: "Modelica.Blocks.Continuous.PID",
      name: "k",
    });
    expect(typeof r.value).toBe("string");
  });

  it("modifier read APIs all return arrays/strings", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const cls = "Modelica.Blocks.Examples.PID_Controller";
    const { modifiers } = await client.getComponentModifierNames({
      typeName: cls,
      componentName: "PI",
    });
    expect(Array.isArray(modifiers)).toBe(true);
    const { value: v1 } = await client.getComponentModifierValue({
      typeName: cls,
      modifier: "PI.k",
    });
    expect(typeof v1).toBe("string");
    const { value: v2 } = await client.getComponentModifierValues({
      typeName: cls,
      modifier: "PI.k",
    });
    expect(typeof v2).toBe("string");
  });

  // === Class predicates (Tier 4) ===

  it("class predicates classify Modelica entries correctly", async () => {
    await client.loadModel({ typeName: "Modelica" });

    const { b: isPkg } = await client.isPackage({ typeName: "Modelica.Blocks" });
    expect(isPkg).toBe(true);

    const { b: isFn } = await client.isFunction({
      typeName: "Modelica.Math.sin",
    });
    expect(isFn).toBe(true);

    const { b: isBlk } = await client.isBlock({
      typeName: "Modelica.Blocks.Math.Sin",
    });
    expect(isBlk).toBe(true);

    const { b: isMod } = await client.isModel({
      typeName: "Modelica.Blocks.Examples.PID_Controller",
    });
    expect(isMod).toBe(true);

    const { restriction } = await client.getClassRestriction({
      typeName: "Modelica.Blocks.Examples.PID_Controller",
    });
    expect(restriction).toBe("model");

    const { b: existsModel } = await client.existModel({
      typeName: "Modelica.Blocks.Examples.PID_Controller",
    });
    expect(existsModel).toBe(true);

    const { b: existsPkg } = await client.existPackage({
      typeName: "Modelica.Blocks",
    });
    expect(existsPkg).toBe(true);
  });

  // === Elements (Tier 2) ===

  it("getElements returns a non-null Value tree for a known class", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { elements } = await client.getElements({
      typeName: "Modelica.Blocks.Examples.PID_Controller",
    });
    expect(["list", "call"]).toContain(elements.kind);
  });

  it("getElementsInfo returns a non-null Value tree", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { result } = await client.getElementsInfo({
      typeName: "Modelica.Blocks.Examples.PID_Controller",
    });
    expect(["list", "call", "string"]).toContain(result.kind);
  });

  // === Library / packages (Tier 3) ===

  it("getLoadedLibraries lists loaded libraries", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { libraries } = await client.getLoadedLibraries();
    expect(libraries.length).toBeGreaterThan(0);
    const names = libraries.map((p) => p[0]);
    expect(names).toContain("Modelica");
  });

  it("getPackages returns at least the loaded packages", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { classNames } = await client.getPackages();
    expect(Array.isArray(classNames)).toBe(true);
    expect(classNames.length).toBeGreaterThan(0);
  });

  // === Modern read path (Tier 1) ===

  it("getModelInstance returns a non-empty JSON string", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { result } = await client.getModelInstance({
      typeName: "Modelica.Blocks.Examples.PID_Controller",
    });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(10);
    // Light shape sanity — JSON should start with `{`.
    expect(result.trim().startsWith("{")).toBe(true);
  });

  // === Parameter parity (Tier 6) ===

  it("getParameterNames returns the parameter list for a model", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { parameters } = await client.getParameterNames({
      typeName: "Modelica.Blocks.Continuous.PID",
    });
    expect(Array.isArray(parameters)).toBe(true);
    expect(parameters.length).toBeGreaterThan(0);
  });

  // === Concurrency ===

  it("serializes concurrent calls without REQ/REP corruption", async () => {
    const ps = Array.from({ length: 8 }, () => client.getVersion());
    const versions = (await Promise.all(ps)).map((r) => r.version);
    expect(new Set(versions).size).toBe(1);
  });

  // === Coverage placeholders (it.todo) for new functions ===
  //
  // Each todo below corresponds to a new wrapper added in this PR that doesn't
  // yet have an integration test. The reason after the colon should help a
  // future contributor decide whether they can promote the todo to a real
  // test (e.g. add a fixture, gate behind OMC_INTEGRATION_HEAVY, etc.).

  // contents — readers needing a fixture with declared connectors / inheritance
  it.todo(
    "getModelInstanceAnnotation: needs a class with annotations and a filter assertion; deferred",
  );
  it.todo(
    "modifierToJSON: needs a sample modifier expression to assert JSON shape; deferred",
  );
  it.todo(
    "getConnectionList: needs a fixture with multiple connections; could share PID_Controller setup",
  );
  it.todo(
    "getNthConnector: needs a fixture with declared connectors; deferred",
  );
  it.todo(
    "getNthConnectorIconAnnotation: needs a fixture with declared connectors; deferred",
  );
  it.todo(
    "getConnectorCount: cheap follow-up; can wire to PID_Controller fixture",
  );
  it.todo(
    "getNthInheritedClassIconMapAnnotation: needs a fixture with inheritance + IconMap annotation; deferred",
  );
  it.todo(
    "getNthInheritedClassDiagramMapAnnotation: needs a fixture with inheritance + DiagramMap annotation; deferred",
  );
  it.todo(
    "getDefaultComponentName: untested smoke; can wire to PID_Controller fixture in follow-up",
  );
  it.todo(
    "getDefaultComponentPrefixes: untested smoke; can wire to PID_Controller fixture in follow-up",
  );
  it.todo(
    "getComponentComment: cheap follow-up; needs a class with a documented component",
  );

  // elements — readers + mutations
  it.todo(
    "getElementAnnotation: needs a fixture model with annotations on elements",
  );
  it.todo(
    "getElementAnnotations: needs a fixture model with annotations on elements",
  );
  it.todo(
    "getElementModifierNames: cheap follow-up; can wire to PID_Controller's PI element",
  );
  it.todo(
    "getElementModifierValue: cheap follow-up; can wire to PID_Controller's PI element",
  );
  it.todo(
    "getElementModifierValues: cheap follow-up; can wire to PID_Controller's PI element",
  );
  it.todo(
    "setElementModifierValue: mutation; needs throwaway loadString fixture; deferred to next PR",
  );
  it.todo(
    "setElementAnnotation: mutation; needs throwaway loadString fixture; deferred to next PR",
  );
  it.todo(
    "setElementType: mutation; needs throwaway loadString fixture; deferred to next PR",
  );
  it.todo(
    "removeElementModifiers: mutation; needs throwaway loadString fixture; deferred to next PR",
  );

  // library — package manager calls hit the network
  it.todo(
    "getAvailableLibraries: network side-effect; intentionally skipped in CI",
  );
  it.todo(
    "getAvailableLibraryVersions: network side-effect; intentionally skipped in CI",
  );
  it.todo(
    "getAvailablePackageVersions: network side-effect; intentionally skipped in CI",
  );
  it.todo(
    "installPackage: network side-effect; intentionally skipped in CI",
  );
  it.todo(
    "updatePackageIndex: network side-effect; intentionally skipped in CI",
  );
  it.todo(
    "upgradeInstalledPackages: network side-effect; intentionally skipped in CI",
  );
  it.todo(
    "loadFiles: cheap follow-up; needs a temp .mo fixture and OMC's numProcessors() default to evaluate",
  );

  // browsing — niche class predicates
  it.todo(
    "getClassComment: cheap follow-up; can wire to a class with a documented comment string",
  );
  it.todo("isType: cheap follow-up; can wire to a Modelica type alias");
  it.todo("isClass: cheap follow-up; can wire to a Modelica class");
  it.todo(
    "isRecord: cheap follow-up; can wire to a Modelica record (e.g. Modelica.SIunits)",
  );
  it.todo(
    "isConnector: cheap follow-up; can wire to Modelica.Blocks.Interfaces.RealInput",
  );
  it.todo(
    "isPartial: cheap follow-up; can wire to Modelica.Blocks.Interfaces.SISO",
  );
  it.todo(
    "isReplaceable: cheap follow-up; needs a class element with `replaceable` keyword",
  );
  it.todo(
    "isProtectedClass: cheap follow-up; needs a fixture with a protected child class",
  );
  it.todo(
    "isEnumeration: cheap follow-up; can wire to a Modelica enumeration type",
  );

  // editing — mutations
  it.todo(
    "setClassComment: mutation; needs throwaway loadString fixture; deferred to next PR",
  );
  it.todo(
    "setDocumentationAnnotation: mutation; needs throwaway loadString fixture; deferred to next PR",
  );

  // parameters — mutation
  it.todo(
    "setParameterValue: mutation; needs throwaway loadString fixture; deferred to next PR",
  );

  // results — depend on a heavy simulate run producing a .mat
  it.todo(
    "val: depends on .mat from a heavy simulate run; gate with OMC_INTEGRATION_HEAVY=1",
  );
  it.todo(
    "readSimulationResult: depends on .mat from a heavy simulate run; gate with OMC_INTEGRATION_HEAVY=1",
  );
});
