/**
 * Investigation: why don't parameters / connections appear in the diagram
 * of a class that purely `extends` another?
 *
 * Two minimal Modelica models:
 *
 *   model Base
 *     parameter Real k = 2;
 *     Modelica.Blocks.Sources.Constant src(k=k) annotation(Placement(...));
 *     Modelica.Blocks.Math.Gain g1(k=3)         annotation(Placement(...));
 *     Modelica.Blocks.Interfaces.RealOutput y   annotation(Placement(...));
 *   equation
 *     connect(src.y, g1.u) annotation(Line(points={...}));
 *     connect(g1.y, y)     annotation(Line(points={...}));
 *   end Base;
 *
 *   model Derived
 *     extends Base;
 *   end Derived;
 *
 * What the test confirms against a live OMC 1.26 (verbatim assertions
 * below):
 *
 *   1. CONNECTIONS are missing from Derived's diagram.
 *      Root cause: `produceDiagramLayout` collects connections as
 *      `mi.connections ?? []` (see producer.ts:404). OMC keeps inherited
 *      equations under `elements[$kind=extends].baseClass.connections`,
 *      never flattened — so the producer never sees them.
 *      Fix shape: walk the extends chain the same way `walkExtendsChain`
 *      already does for sub-components and connectors. Dedup-policy is a
 *      design question (host overrides? cumulative?), but the simple
 *      "concat ancestor connections first, host last" matches Modelica
 *      flattening semantics.
 *
 *   2. PARAMETERS on the HOST CLASS are missing — but for a different
 *      reason. `class-parameter-form.ts:75` (`buildClassParameterForm`)
 *      iterates `instance.elements ?? []` directly. Its file-level
 *      comment already calls this out:
 *        "Top-level (own) parameters only — inherited parameters from
 *         `extends` aren't surfaced yet."
 *      So this half is a known scope gap, not a hidden bug.
 *
 *   3. PER-INSTANCE modifiers on sub-components ARE inherited correctly
 *      (g1's k=3, src's k=k both survive). Sub-components themselves
 *      inherit via `walkExtendsChain` in the producer. So the icon
 *      rendering for Derived is mostly fine — what's missing is just
 *      the equation-routing (connections) layer on top.
 *
 * Auto-skips when `omc` isn't on PATH.
 */

import { execSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OmcClient } from "../src/client.js";
import { produceDiagramLayout } from "../src/api/diagram/producer.js";
import {
  ModelInstanceSchema,
  type ModelInstance,
} from "../src/_shared/modelInstance.js";

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

const PACKAGE_SOURCE = `
package ExtendsInvestigation
  model Base
    parameter Real k = 2
      annotation (Dialog(group="Parameters"));
    Modelica.Blocks.Sources.Constant src(k=k)
      annotation (Placement(transformation(extent={{-60,-10},{-40,10}})));
    Modelica.Blocks.Math.Gain g1(k=3)
      annotation (Placement(transformation(extent={{-10,-10},{10,10}})));
    Modelica.Blocks.Interfaces.RealOutput y
      annotation (Placement(transformation(extent={{90,-10},{110,10}})));
  equation
    connect(src.y, g1.u)
      annotation (Line(points={{-39,0},{-12,0}}, color={0,0,127}));
    connect(g1.y, y)
      annotation (Line(points={{11,0},{100,0}}, color={0,0,127}));
  end Base;

  model Derived
    extends Base;
  end Derived;
end ExtendsInvestigation;
`;

describeIf("extends-investigation: missing connections in derived diagram", () => {
  let client: OmcClient;
  let baseInstance: ModelInstance;
  let derivedInstance: ModelInstance;

  beforeAll(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    const m = await client.loadModel({ typeName: "Modelica" });
    if (!m.success) {
      const { errorString } = await client.getErrorString();
      throw new Error(`loadModel(Modelica) failed: ${errorString}`);
    }
    const loaded = await client.loadString({
      data: PACKAGE_SOURCE,
      filename: "<extends-investigation>",
    });
    if (!loaded.success) {
      const { errorString } = await client.getErrorString();
      throw new Error(`loadString failed: ${errorString}`);
    }
    const base = await client.getModelInstance({
      typeName: "ExtendsInvestigation.Base",
    });
    baseInstance = ModelInstanceSchema.parse(base.instance);
    const derived = await client.getModelInstance({
      typeName: "ExtendsInvestigation.Derived",
    });
    derivedInstance = ModelInstanceSchema.parse(derived.instance);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
  });

  // ------------------------------------------------------------------
  // First: confirm what OMC actually returns for the two models. This
  // is the ground truth our diagnosis sits on.
  // ------------------------------------------------------------------

  it("OMC: Base has its connections at the top level", () => {
    const conns = baseInstance.connections ?? [];
    // Two `connect(...)` equations in the source.
    expect(conns).toHaveLength(2);
  });

  it("OMC: Derived has NO top-level connections — they live under elements[extends].baseClass", () => {
    // This is the load-bearing observation. If OMC ever changes to flatten
    // inherited connections into the host, the producer wouldn't need to
    // walk for them and this expectation would flip.
    const topLevel = derivedInstance.connections ?? [];
    expect(topLevel).toHaveLength(0);

    const extendsElement = (derivedInstance.elements ?? []).find(
      (e) => e.$kind === "extends",
    );
    expect(extendsElement).toBeDefined();
    const base =
      extendsElement && typeof extendsElement.baseClass === "object"
        ? extendsElement.baseClass
        : undefined;
    expect(base).toBeDefined();
    // Inherited connections are stashed here, where the producer's
    // connection-emission loop never looks.
    expect(base?.connections?.length ?? 0).toBe(2);
  });

  it("OMC: Derived's elements[extends].baseClass DOES carry inherited components", () => {
    // Sanity for the OTHER walk path — sub-components are accessible via
    // the same nested baseClass tree the producer's `walkExtendsChain`
    // already follows.
    const ext = (derivedInstance.elements ?? []).find(
      (e) => e.$kind === "extends",
    );
    const base =
      ext && typeof ext.baseClass === "object" ? ext.baseClass : undefined;
    const names = (base?.elements ?? [])
      .filter((e) => e.$kind === "component")
      .map((e) => (e as { name: string }).name)
      .sort();
    expect(names).toEqual(["g1", "k", "src", "y"]);
  });

  // ------------------------------------------------------------------
  // Now: what does the producer make of all this?
  // ------------------------------------------------------------------

  it("producer: Base layout has 2 connections + 3 sub-components on the diagram", () => {
    const layout = produceDiagramLayout(baseInstance, "diagram");
    expect(layout.connections).toHaveLength(2);
    // src, g1 are sub-components; y is a standalone host port; k is a
    // scalar parameter (Real → primitive type, filtered out of the
    // diagram walk by design).
    expect(Object.keys(layout.components).sort()).toEqual(["g1", "src"]);
    expect(Object.keys(layout.connectors).sort()).toEqual(["y"]);
  });

  it("producer: Derived layout INHERITS sub-components but LOSES connections — BUG", () => {
    const layout = produceDiagramLayout(derivedInstance, "diagram");

    // Sub-components inherit correctly — `produceDiagramLayout` walks
    // `walkExtendsChain` and copies in ancestor components.
    expect(Object.keys(layout.components).sort()).toEqual(["g1", "src"]);
    // Standalone connector inherits via walkConnectors — also correct.
    expect(Object.keys(layout.connectors).sort()).toEqual(["y"]);

    // But the two connections from Base are gone, because the producer
    // only iterates `mi.connections` on the host and never descends
    // through `elements[$kind=extends].baseClass.connections`.
    //
    // This assertion documents the bug. When the producer is fixed to
    // walk the extends chain for connections, flip this to `toHaveLength(2)`.
    expect(layout.connections).toHaveLength(0);
  });

  it("producer: per-instance modifiers ARE inherited (k=3 on g1, k=k on src)", () => {
    // Cross-check the 'parameters are missing' half of the symptom: the
    // per-instance modifier blocks Base wrote on g1 and src DO survive
    // the inheritance walk, because instanceFromSubComponent reads
    // `el.modifiers` and the ancestor-walk loop calls it the same way.
    const layout = produceDiagramLayout(derivedInstance, "diagram");
    expect(layout.components.g1?.modifiers).toBeDefined();
    expect(layout.components.src?.modifiers).toBeDefined();
  });

  // ------------------------------------------------------------------
  // Where on the existing model tree do the missing equations live?
  // Printed to stderr to make the investigation reproducible by eye.
  // ------------------------------------------------------------------

  it("dumps the location of the missing connections (informational)", () => {
    const ext = (derivedInstance.elements ?? []).find(
      (e) => e.$kind === "extends",
    );
    const base =
      ext && typeof ext.baseClass === "object" ? ext.baseClass : undefined;
    const cs = base?.connections ?? [];
    console.error(
      `[investigation] Derived.connections (top-level) = ${
        (derivedInstance.connections ?? []).length
      }`,
    );
    console.error(
      `[investigation] Derived.elements[extends].baseClass.name = ${base?.name}`,
    );
    console.error(
      `[investigation] Derived.elements[extends].baseClass.connections.length = ${cs.length}`,
    );
    for (const c of cs) {
      const lhs = (c.lhs.parts ?? [])
        .map((p) => (p as { name: string }).name)
        .join(".");
      const rhs = (c.rhs.parts ?? [])
        .map((p) => (p as { name: string }).name)
        .join(".");
      const hasLine =
        c.annotation && (c.annotation as { Line?: unknown }).Line !== undefined;
      console.error(
        `[investigation]   connect(${lhs}, ${rhs}) hasLine=${hasLine}`,
      );
    }
    expect(cs.length).toBeGreaterThan(0);
  });
});
