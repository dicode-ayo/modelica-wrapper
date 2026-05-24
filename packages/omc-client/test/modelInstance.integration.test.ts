/**
 * Live integration tests for the `getModelInstance` recursive Zod schema.
 *
 * These tests replace the previous offline-fixture suite (which committed
 * ~40k lines of OMC JSON to git). The same assertions now run against a
 * fresh `getModelInstance` capture from the live OMC each test run; the
 * captured fixtures are regenerable on demand via:
 *
 *   pnpm --filter @dicode/omc-client capture-modelinstance-fixtures
 *
 * Auto-skips when `omc` isn't on PATH, mirroring `integration.test.ts`.
 *
 * Coverage parity with the dropped offline tests:
 *
 *   1. Sin: parses cleanly via `ModelInstanceSchema`.
 *   2. PID_Controller: parses cleanly via `ModelInstanceSchema`.
 *   3. Sin annotation-only: parses cleanly via `ModelInstanceAnnotationSchema`.
 *   4. Sin spot-checks (name, restriction, extends-of-SISO, Icon graphics).
 *   5. PID_Controller spot-checks (connections cref shape, components).
 *   6. Recursion-no-op regression markers: a permissive
 *      `z.object({}).passthrough()` branch on `ComponentElementSchema.type`
 *      once made every nested `ModelInstance` validate as a wildcard. If
 *      that bug returns, mutating any deeply-nested required field must
 *      surface as a `safeParse` failure rather than the schema
 *      rubber-stamping the broken shape. These mutation tests reuse the
 *      live capture — they don't need a fixture-frozen tree.
 */

import { execSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OmcClient } from "../src/client.js";
import {
  ModelInstanceAnnotationSchema,
  ModelInstanceSchema,
  type ExtendsElement,
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

function dumpIssues(label: string, json: unknown): string {
  const r = ModelInstanceSchema.safeParse(json);
  if (r.success) return `${label}: parsed cleanly`;
  return `${label}: ${JSON.stringify(r.error.issues.slice(0, 5), null, 2)}`;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

describeIf("ModelInstanceSchema against live OMC", () => {
  let client: OmcClient;
  // Captured once per file so the mutation-regression tests can reuse the
  // PID_Controller tree without paying the OMC round-trip cost three times.
  let sinInstance: ModelInstance;
  let sinAnnotationInstance: ModelInstance;
  let pidInstance: ModelInstance;

  beforeAll(async () => {
    client = await OmcClient.create({
      omcPath: process.env.OMC_PATH ?? "",
    });
    const { success } = await client.loadModel({ typeName: "Modelica" });
    if (!success) {
      const { errorString } = await client.getErrorString();
      throw new Error(`loadModel(Modelica) failed: ${errorString}`);
    }
    const sin = await client.getModelInstance({
      typeName: "Modelica.Blocks.Math.Sin",
    });
    sinInstance = sin.instance;
    const sinAnn = await client.getModelInstanceAnnotation({
      typeName: "Modelica.Blocks.Math.Sin",
    });
    sinAnnotationInstance = sinAnn.instance;
    const pid = await client.getModelInstance({
      typeName: "Modelica.Blocks.Examples.PID_Controller",
    });
    pidInstance = pid.instance;
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  it("parses the live Sin tree cleanly", () => {
    const parsed = ModelInstanceSchema.safeParse(sinInstance);
    if (!parsed.success) {
      throw new Error(dumpIssues("Sin", sinInstance));
    }
    expect(parsed.success).toBe(true);
  });

  it("parses the live PID_Controller tree cleanly", () => {
    const parsed = ModelInstanceSchema.safeParse(pidInstance);
    if (!parsed.success) {
      throw new Error(dumpIssues("PID_Controller", pidInstance));
    }
    expect(parsed.success).toBe(true);
  });

  it("parses the live Sin annotation-only tree", () => {
    const parsed = ModelInstanceAnnotationSchema.safeParse(
      sinAnnotationInstance,
    );
    if (!parsed.success) {
      throw new Error(dumpIssues("Sin annotation", sinAnnotationInstance));
    }
    expect(parsed.success).toBe(true);
  });

  it("Sin spot-checks: name, restriction, extends-of-SISO, non-empty Icon graphics", () => {
    const parsed = ModelInstanceSchema.parse(sinInstance);
    expect(parsed.name).toBe("Modelica.Blocks.Math.Sin");
    expect(parsed.restriction).toBe("block");
    expect(Array.isArray(parsed.elements)).toBe(true);

    const elements = parsed.elements ?? [];
    const ext = elements.find(
      (e): e is ExtendsElement => e.$kind === "extends",
    );
    expect(ext).toBeDefined();
    if (!ext || typeof ext.baseClass !== "object") {
      throw new Error("expected nested baseClass object on Sin's extends");
    }
    expect(ext.baseClass.name).toMatch(/SISO|Block|Interfaces/);

    const icon = parsed.annotation?.Icon;
    expect(icon).toBeDefined();
    expect(Array.isArray(icon?.graphics)).toBe(true);
    expect((icon?.graphics ?? []).length).toBeGreaterThan(0);
  });

  it("PID_Controller spot-checks: connections, cref shape, components", () => {
    const parsed = ModelInstanceSchema.parse(pidInstance);
    expect(parsed.name).toBe("Modelica.Blocks.Examples.PID_Controller");
    expect(Array.isArray(parsed.connections)).toBe(true);

    const connections = parsed.connections ?? [];
    expect(connections.length).toBeGreaterThan(0);
    for (const c of connections) {
      expect(c.lhs.$kind).toBe("cref");
      expect(c.rhs.$kind).toBe("cref");
      expect(c.lhs.parts.length).toBeGreaterThan(0);
      expect(c.rhs.parts.length).toBeGreaterThan(0);
    }

    const elements = parsed.elements ?? [];
    const components = elements.filter((e) => e.$kind === "component");
    expect(components.length).toBeGreaterThan(0);
    const names = components.map((c) => c.name);
    expect(names).toContain("PI");
  });

  // Regression marker for the schema-recursion-no-op blocker that was
  // discovered during PR #2 review: a permissive `z.object({}).passthrough()`
  // branch on `ComponentElementSchema.type` made every nested
  // `ModelInstance` validate as a wildcard object — short-circuiting the
  // recursive checks. If that bug returns, mutating any deeply-nested
  // required field must surface as a `safeParse` failure rather than the
  // schema rubber-stamping the broken shape.
  describe("rejects mutated trees", () => {
    it("flags a bogus nested $kind on a discriminated element", () => {
      const data = clone(pidInstance) as {
        elements?: Array<{ $kind?: string }>;
      };
      // Mutate a top-level element's $kind to a value the discriminated
      // union does not know about. With the no-op union, this would still
      // parse.
      const first = data.elements?.[0];
      if (!first) throw new Error("live tree missing elements[0]");
      first.$kind = "bogus";
      const r = ModelInstanceSchema.safeParse(data);
      expect(r.success).toBe(false);
    });

    it("flags a wrong-typed top-level field", () => {
      const data = clone(pidInstance) as { restriction?: unknown };
      data.restriction = 42;
      const r = ModelInstanceSchema.safeParse(data);
      expect(r.success).toBe(false);
    });

    it("flags a deeply-nested wrong-typed required field", () => {
      // Find any nested ModelInstance under elements[*].type and corrupt
      // its `name`. With recursion validating end-to-end, this must fail.
      const data = clone(pidInstance);
      let mutated = false;
      const walk = (obj: unknown): void => {
        if (mutated || obj === null || typeof obj !== "object") return;
        if (Array.isArray(obj)) {
          for (const v of obj) walk(v);
          return;
        }
        const rec = obj as Record<string, unknown>;
        if (
          rec.$kind === "component" &&
          rec.type !== null &&
          typeof rec.type === "object"
        ) {
          (rec.type as Record<string, unknown>).name = 123;
          mutated = true;
          return;
        }
        for (const v of Object.values(rec)) walk(v);
      };
      walk(data);
      if (!mutated) throw new Error("live tree had no nested component.type");
      const r = ModelInstanceSchema.safeParse(data);
      expect(r.success).toBe(false);
    });
  });
});
