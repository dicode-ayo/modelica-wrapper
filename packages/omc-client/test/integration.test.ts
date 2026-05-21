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

  it("getAvailableMatchingAlgorithms returns aligned choice/comment arrays", async () => {
    const { allChoices, allComments } = await client.getAvailableMatchingAlgorithms();
    expect(Array.isArray(allChoices)).toBe(true);
    expect(Array.isArray(allComments)).toBe(true);
    expect(allChoices.length).toBe(allComments.length);
    expect(allChoices.length).toBeGreaterThan(0);
    expect(allChoices).toContain("PFPlusExt");
  });

  it("getAvailableIndexReductionMethods returns aligned choice/comment arrays", async () => {
    const { allChoices, allComments } = await client.getAvailableIndexReductionMethods();
    expect(Array.isArray(allChoices)).toBe(true);
    expect(Array.isArray(allComments)).toBe(true);
    expect(allChoices.length).toBe(allComments.length);
    expect(allChoices.length).toBeGreaterThan(0);
    expect(allChoices).toContain("dynamicStateSelection");
  });

  it("getAvailableTearingMethods returns aligned choice/comment arrays", async () => {
    const { allChoices, allComments } = await client.getAvailableTearingMethods();
    expect(Array.isArray(allChoices)).toBe(true);
    expect(Array.isArray(allComments)).toBe(true);
    expect(allChoices.length).toBe(allComments.length);
    expect(allChoices.length).toBeGreaterThan(0);
  });

  it("setMatchingAlgorithm round-trips through getMatchingAlgorithm", async () => {
    const set = await client.setMatchingAlgorithm({ algorithm: "PFPlusExt" });
    expect(set.success).toBe(true);
    const { selected } = await client.getMatchingAlgorithm();
    expect(selected).toBe("PFPlusExt");
  });

  it("setIndexReductionMethod round-trips through getIndexReductionMethod", async () => {
    const set = await client.setIndexReductionMethod({
      method: "dynamicStateSelection",
    });
    expect(set.success).toBe(true);
    const { selected } = await client.getIndexReductionMethod();
    expect(selected).toBe("dynamicStateSelection");
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

  // === Parameter parity (Tier 6) ===

  it("getParameterNames returns the parameter list for a model", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { parameters } = await client.getParameterNames({
      typeName: "Modelica.Blocks.Continuous.PID",
    });
    expect(Array.isArray(parameters)).toBe(true);
    expect(parameters.length).toBeGreaterThan(0);
  });

  // === Deep-inspection readers (verified on OMC 1.26.7) ===

  it("getEnumerationLiterals returns the literal names of a Modelica enum", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { literals } = await client.getEnumerationLiterals({
      typeName: "Modelica.Blocks.Types.Init",
    });
    expect(literals).toEqual([
      "NoInit",
      "SteadyState",
      "InitialState",
      "InitialOutput",
    ]);
  });

  it("getEnumerationLiterals returns an empty array for a non-enum class", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { literals } = await client.getEnumerationLiterals({
      typeName: "Modelica.Blocks.Math.Sin",
    });
    expect(literals).toEqual([]);
  });

  it("getInstantiatedParametersAndValues returns name=value bindings", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { result } = await client.getInstantiatedParametersAndValues({
      typeName: "Modelica.Blocks.Continuous.PID",
    });
    expect(result.length).toBeGreaterThan(0);
    // Every entry should be a non-empty string containing `=`.
    for (const entry of result) {
      expect(entry).toMatch(/=/);
    }
    // PID has a `k` parameter — assert it appears with a default value.
    expect(result.some((s) => /^\s*k\s*=/.test(s))).toBe(true);
  });

  it("getAnnotationNamedModifiers lists Icon's named modifiers", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { result } = await client.getAnnotationNamedModifiers({
      typeName: "Modelica.Blocks.Math.Sin",
      annotation: "Icon",
    });
    expect(result).toEqual(
      expect.arrayContaining(["coordinateSystem", "graphics"]),
    );
  });

  it("getAnnotationModifierValue returns the raw modifier text", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { value } = await client.getAnnotationModifierValue({
      typeName: "Modelica.Blocks.Math.Sin",
      annotation: "Icon",
      modifier: "graphics",
    });
    // OMC wraps the value list in `$Code(…)` per graphic primitive.
    expect(value).toContain("$Code(");
  });

  // === Niche class predicates (Tier 4 promoted from 🟡 → ✅) ===

  it("class predicates classify niche Modelica entries correctly", async () => {
    await client.loadModel({ typeName: "Modelica" });

    const { b: isTypeTime } = await client.isType({
      typeName: "Modelica.Units.SI.Time",
    });
    expect(isTypeTime).toBe(true);

    const { b: isRecord } = await client.isRecord({
      typeName: "Modelica.Media.Interfaces.PartialMedium.ThermodynamicState",
    });
    expect(isRecord).toBe(true);

    const { b: isConnector } = await client.isConnector({
      typeName: "Modelica.Blocks.Interfaces.RealInput",
    });
    expect(isConnector).toBe(true);

    const { b: isPartial } = await client.isPartial({
      typeName: "Modelica.Blocks.Interfaces.SISO",
    });
    expect(isPartial).toBe(true);
  });

  it("getClassComment returns the description string of a documented class", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { comment } = await client.getClassComment({
      typeName: "Modelica.Blocks.Math.Sin",
    });
    expect(comment).toMatch(/sine/i);
  });

  // === Contents readers ===

  it("getConnectionList returns parsed from/to/comment rows for a diagram model", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { result } = await client.getConnectionList({
      typeName: "Modelica.Blocks.Examples.PID_Controller",
    });
    expect(result.length).toBeGreaterThan(0);
    for (const row of result) {
      expect(typeof row.from).toBe("string");
      expect(typeof row.to).toBe("string");
      expect(typeof row.comment).toBe("string");
    }
    // The PID example wires PI.y → torque.tau among others.
    expect(result.some((c) => c.from === "PI.y" && c.to === "torque.tau")).toBe(
      true,
    );
  });

  it("getDefaultComponentName / getDefaultComponentPrefixes return strings (possibly empty)", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { name } = await client.getDefaultComponentName({
      typeName: "Modelica.Blocks.Math.Sin",
    });
    expect(typeof name).toBe("string");
    const { prefixes } = await client.getDefaultComponentPrefixes({
      typeName: "Modelica.Blocks.Math.Sin",
    });
    expect(typeof prefixes).toBe("string");
  });

  it("getComponentComment returns the comment string for a component (or empty)", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { comment } = await client.getComponentComment({
      typeName: "Modelica.Blocks.Examples.PID_Controller",
      componentName: "PI",
    });
    expect(typeof comment).toBe("string");
  });

  it("modifierToJSON encodes a Modelica modifier as JSON", async () => {
    const { json } = await client.modifierToJSON({ modifier: "k=2.5" });
    expect(json.length).toBeGreaterThan(0);
    // The value should be parseable JSON containing the literal.
    const parsed = JSON.parse(json);
    expect(String(parsed)).toContain("2.5");
  });

  it("getModelInstanceAnnotation returns the annotation subset of the structured AST", async () => {
    await client.loadModel({ typeName: "Modelica" });
    // Use Modelica.Blocks.Math.Sin (a leaf block) — the larger
    // PID_Controller Examples class causes `getModelInstanceAnnotation`
    // to return null on the OM-fork MSL 4.1.0+maint.om that CI uses,
    // even though the full `getModelInstance` works fine on the same
    // class. The sibling test in modelInstance.integration.test.ts
    // already validates the annotation-only call on Sin.
    const cls = "Modelica.Blocks.Math.Sin";
    const { instance } = await client.getModelInstanceAnnotation({
      typeName: cls,
    });
    expect(instance.name).toBe(cls);
    expect(instance.restriction).toBe("block");
    expect(instance.annotation).toBeDefined();
  });

  it("getModelInstanceAnnotation with the icon filter returns Icon and prunes the rest (#25)", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const cls = "Modelica.Blocks.Math.Sin";
    // OMEdit's icon-only filter set (OMCProxy.cpp:3426-3441).
    const { instance: filtered } = await client.getModelInstanceAnnotation({
      typeName: cls,
      filter: ["Icon", "IconMap", "Diagram", "DiagramMap", "experiment"],
    });
    expect(filtered.name).toBe(cls);
    const icon = filtered.annotation?.Icon;
    expect(Array.isArray(icon?.graphics)).toBe(true);
    expect((icon?.graphics ?? []).length).toBeGreaterThan(0);
    // The filter genuinely prunes non-listed annotations (Documentation,
    // etc.), so the filtered payload is no larger than the unfiltered
    // annotation subset for the same class.
    const { instance: unfiltered } = await client.getModelInstanceAnnotation({
      typeName: cls,
    });
    expect(JSON.stringify(filtered).length).toBeLessThanOrEqual(
      JSON.stringify(unfiltered).length,
    );
  });

  it("getModelInstanceAnnotation accepts an explicit empty filter (fill(\"\", 0), not {}) (#25)", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const cls = "Modelica.Blocks.Math.Sin";
    // Regression guard for the audit.md §2.10 trap: a bare `{}` for this
    // String[:] arg makes OMC's interactive parser report the misleading
    // "Class getModelInstanceAnnotation not found in scope". The wrapper
    // emits `fill("", 0)` instead, so an explicit empty filter must work.
    const { instance } = await client.getModelInstanceAnnotation({
      typeName: cls,
      filter: [],
    });
    expect(instance.name).toBe(cls);
    expect(instance.annotation).toBeDefined();
  });

  // === Element readers (modern Component* generalization) ===

  it("getElementAnnotation returns the annotation string for an element", async () => {
    await client.loadModel({ typeName: "Modelica" });
    // `typeName` is the FULL dotted element path per the wrapper's
    // package-wide TypeName-rename convention (OMC's signature is
    // `getElementAnnotation(TypeName elementName)`).
    const { annotationString } = await client.getElementAnnotation({
      typeName: "Modelica.Blocks.Examples.PID_Controller.PI",
    });
    expect(annotationString.length).toBeGreaterThan(0);
  });

  it("getElementAnnotations returns a non-null Value tree", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { result } = await client.getElementAnnotations({
      typeName: "Modelica.Blocks.Examples.PID_Controller",
    });
    expect(["list", "call"]).toContain(result.kind);
  });

  it("getElementModifierNames lists the modifiers on a component element", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { modifiers } = await client.getElementModifierNames({
      typeName: "Modelica.Blocks.Examples.PID_Controller",
      elementName: "PI",
    });
    expect(modifiers.length).toBeGreaterThan(0);
    // PI is a PID controller — `k` is always one of its modifiers.
    expect(modifiers).toContain("k");
  });

  it("getElementModifierValue and getElementModifierValues both return strings for PI.k", async () => {
    await client.loadModel({ typeName: "Modelica" });
    const { value: valueOnly } = await client.getElementModifierValue({
      typeName: "Modelica.Blocks.Examples.PID_Controller",
      modifier: "PI.k",
    });
    expect(valueOnly).toContain("100");
    const { value: valueWithEq } = await client.getElementModifierValues({
      typeName: "Modelica.Blocks.Examples.PID_Controller",
      modifier: "PI.k",
    });
    // The Values variant includes the leading `= ` form.
    expect(valueWithEq).toContain("100");
  });

  it("getReplaceableChoices returns the redeclare-choices matrix", async () => {
    await client.loadModel({ typeName: "Modelica" });
    // Modelica.Fluid.System declares `replaceable package Medium = …
    // PartialMedium`. The choices are the concrete Medium classes.
    const { choices } = await client.getReplaceableChoices({
      baseClass: "Modelica.Media.Interfaces.PartialMedium",
      parentClass: "Modelica.Fluid.System",
    });
    expect(choices.length).toBeGreaterThan(0);
    // Each row is `[choiceClass, description]`; both should be non-empty
    // strings except for the synthesized header row which uses the
    // element name as the choice slot.
    for (const row of choices) {
      expect(row.length).toBe(2);
      expect(typeof row[0]).toBe("string");
      expect(typeof row[1]).toBe("string");
    }
    // The Modelica.Media.* concrete classes should appear somewhere in
    // the matrix.
    const classes = choices.map((r) => r[0]);
    expect(classes.some((c) => c.startsWith("Modelica.Media."))).toBe(true);
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

  // contents — inherited-class map annotation readers (issue #39)
  //
  // These two wrappers need a fixture where a child class extends a parent
  // and the `extends` clause itself carries `IconMap` / `DiagramMap`
  // annotations. The wrappers walk the inheritance chain by 1-based index
  // and return the n-th parent's map annotation as a raw `Value` tree.
  //
  // OMC subtlety: `IconMap`/`DiagramMap` declared on the *parent class's*
  // annotation block come back as an empty modifier list (`{Parent, {}}`).
  // They must live on the *extends clause itself* in the child to populate
  // the inherited map. The returned tuple is positional —
  // `{parentName, extent_x1, extent_y1, extent_x2, extent_y2, primitivesVisible}`
  // — so we assert on the parent name and the boolean tail.

  describe("inherited-class map annotations", () => {
    let pkg: string;

    beforeEach(async () => {
      const { randomBytes } = await import("node:crypto");
      pkg = `MwInhMap_${randomBytes(4).toString("hex")}`;
      await client.loadString({
        data: `package ${pkg}
  block Parent
  end Parent;
  block Child
    extends Parent annotation(
      IconMap(primitivesVisible = true),
      DiagramMap(primitivesVisible = false));
  end Child;
end ${pkg};
`,
        filename: `<fixture:${pkg}>`,
      });
    });

    afterEach(async () => {
      await client.deleteClass({ typeName: pkg });
    });

    it("getNthInheritedClassIconMapAnnotation returns the IconMap tree carried on the extends clause", async () => {
      const { result } = await client.getNthInheritedClassIconMapAnnotation({
        typeName: `${pkg}.Child`,
        n: 1,
      });
      expect(result.kind).toBe("list");
      // The Value tree is the positional tuple `{parentName, x1, y1, x2, y2, primitivesVisible=true}`.
      const json = JSON.stringify(result);
      expect(json).toContain("Parent");
      expect(json).toContain("true");
    });

    it("getNthInheritedClassDiagramMapAnnotation returns the DiagramMap tree carried on the extends clause", async () => {
      const { result } = await client.getNthInheritedClassDiagramMapAnnotation({
        typeName: `${pkg}.Child`,
        n: 1,
      });
      expect(result.kind).toBe("list");
      // The Value tree is the positional tuple `{parentName, x1, y1, x2, y2, primitivesVisible=false}`.
      const json = JSON.stringify(result);
      expect(json).toContain("Parent");
      expect(json).toContain("false");
    });
  });

  // (getConnectorCount / getNthConnector / getNthConnectorIconAnnotation
  //  now covered in mutations.integration.test.ts "connectors" describe.)

  // (setElementModifierValue / setElementType / removeElementModifiers /
  //  setElementAnnotation now covered in mutations.integration.test.ts
  //  "element mutations" describe. setElementAnnotation needed a wrapper
  //  fix in #38: the payload is `$Code((<expr>))` per OMEdit, not the
  //  leading-`=` `$Code(=<expr>)` which silently cleared the annotation.)

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
  // (loadFiles now covered in mutations.integration.test.ts — needs the
  //  temp-dir + writeFile machinery the editing suite already uses.)

  // (isClass / isReplaceable / isProtectedClass now covered in
  //  mutations.integration.test.ts "class predicates with fixtures"
  //  describe.)

  // (editing-mutations setClassComment / setDocumentationAnnotation and
  //  parameters setParameterValue now covered in mutations.integration.test.ts.)

  // results — exercised by `results-heavy.integration.test.ts` (gated by
  // OMC_INTEGRATION_HEAVY=1); that suite simulates a tiny ramp model in a
  // temp directory and covers every results-category wrapper.

});
