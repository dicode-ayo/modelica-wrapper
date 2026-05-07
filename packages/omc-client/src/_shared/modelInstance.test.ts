/**
 * Offline schema tests against committed `getModelInstance` JSON fixtures
 * captured from OMC 1.26.7. These are the source of truth for the recursive
 * shape — drift here means OMC changed something.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ModelInstanceAnnotationSchema,
  ModelInstanceSchema,
  type ExtendsElement,
} from "./modelInstance.js";

const FIXTURES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test",
  "fixtures",
);

function loadFixture(name: string): unknown {
  const path = resolve(FIXTURES_DIR, name);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function dumpIssues(label: string, json: unknown): string {
  const r = ModelInstanceSchema.safeParse(json);
  if (r.success) return `${label}: parsed cleanly`;
  return `${label}: ${JSON.stringify(r.error.issues.slice(0, 5), null, 2)}`;
}

describe("ModelInstanceSchema", () => {
  it("parses the Sin fixture cleanly", () => {
    const data = loadFixture("sin.modelInstance.json");
    const parsed = ModelInstanceSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error(dumpIssues("Sin", data));
    }
    expect(parsed.success).toBe(true);
  });

  it("parses the PID_Controller fixture cleanly", () => {
    const data = loadFixture("pidController.modelInstance.json");
    const parsed = ModelInstanceSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error(dumpIssues("PID_Controller", data));
    }
    expect(parsed.success).toBe(true);
  });

  it("parses the Sin annotation-only fixture", () => {
    const data = loadFixture("sin.modelInstanceAnnotation.json");
    const parsed = ModelInstanceAnnotationSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error(dumpIssues("Sin annotation", data));
    }
    expect(parsed.success).toBe(true);
  });

  it("Sin spot-checks: name, restriction, extends-of-SISO, non-empty Icon graphics", () => {
    const data = loadFixture("sin.modelInstance.json");
    const parsed = ModelInstanceSchema.parse(data);
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
    const data = loadFixture("pidController.modelInstance.json");
    const parsed = ModelInstanceSchema.parse(data);
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
  // discovered during review: a permissive `z.object({}).passthrough()`
  // branch on `ComponentElementSchema.type` made every nested
  // `ModelInstance` validate as a wildcard object — short-circuiting the
  // recursive checks. If that bug returns, mutating any deeply-nested
  // required field must surface as a `safeParse` failure rather than the
  // schema rubber-stamping the broken shape.
  describe("rejects mutated fixtures", () => {
    function clone<T>(v: T): T {
      return JSON.parse(JSON.stringify(v)) as T;
    }

    it("flags a bogus nested $kind on a discriminated element", () => {
      const data = clone(
        loadFixture("pidController.modelInstance.json"),
      ) as { elements?: Array<{ $kind?: string }> };
      // Mutate a deep element's $kind to a value the discriminated union
      // does not know about. With the no-op union, this would still parse.
      const first = data.elements?.[0];
      if (!first) throw new Error("fixture missing elements[0]");
      first.$kind = "bogus";
      const r = ModelInstanceSchema.safeParse(data);
      expect(r.success).toBe(false);
    });

    it("flags a wrong-typed top-level field", () => {
      const data = clone(
        loadFixture("pidController.modelInstance.json"),
      ) as { restriction?: unknown };
      data.restriction = 42;
      const r = ModelInstanceSchema.safeParse(data);
      expect(r.success).toBe(false);
    });

    it("flags a deeply-nested wrong-typed required field", () => {
      // Find any nested ModelInstance under elements[*].type and corrupt
      // its `name`. With recursion validating end-to-end, this must fail.
      const data = clone(loadFixture("pidController.modelInstance.json"));
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
      if (!mutated) throw new Error("fixture had no nested component.type");
      const r = ModelInstanceSchema.safeParse(data);
      expect(r.success).toBe(false);
    });
  });
});
