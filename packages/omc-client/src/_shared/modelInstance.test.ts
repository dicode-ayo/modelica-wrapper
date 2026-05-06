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
  type ConnectionNode,
  type ElementNode,
  type ExtendsElement,
  type GraphicAnnotation,
  type ModelInstance,
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
    const parsed = ModelInstanceSchema.parse(data) as ModelInstance;
    expect(parsed.name).toBe("Modelica.Blocks.Math.Sin");
    expect(parsed.restriction).toBe("block");
    expect(Array.isArray(parsed.elements)).toBe(true);

    const elements = parsed.elements as ElementNode[];
    const ext = elements.find(
      (e): e is ExtendsElement => e.$kind === "extends",
    );
    expect(ext).toBeDefined();
    if (!ext || typeof ext.baseClass !== "object") {
      throw new Error("expected nested baseClass object on Sin's extends");
    }
    expect(ext.baseClass.name).toMatch(/SISO|Block|Interfaces/);

    const icon = parsed.annotation?.Icon as GraphicAnnotation | undefined;
    expect(icon).toBeDefined();
    expect(Array.isArray(icon?.graphics)).toBe(true);
    expect((icon?.graphics ?? []).length).toBeGreaterThan(0);
  });

  it("PID_Controller spot-checks: connections, cref shape, components", () => {
    const data = loadFixture("pidController.modelInstance.json");
    const parsed = ModelInstanceSchema.parse(data) as ModelInstance;
    expect(parsed.name).toBe("Modelica.Blocks.Examples.PID_Controller");
    expect(Array.isArray(parsed.connections)).toBe(true);

    const connections = parsed.connections as ConnectionNode[];
    expect(connections.length).toBeGreaterThan(0);
    for (const c of connections) {
      expect(c.lhs.$kind).toBe("cref");
      expect(c.rhs.$kind).toBe("cref");
      expect(c.lhs.parts.length).toBeGreaterThan(0);
      expect(c.rhs.parts.length).toBeGreaterThan(0);
    }

    const elements = parsed.elements as ElementNode[];
    const components = elements.filter((e) => e.$kind === "component");
    expect(components.length).toBeGreaterThan(0);
    const names = components.map((c) => c.name);
    expect(names).toContain("PI");
  });
});
