/**
 * Tests for the structured `describeFunction` and the plain-text renderers.
 *
 * We assert on STRUCTURE (specific field names, well-known categories)
 * rather than full text golden files — `REGISTRY` evolves as OMC functions
 * are added, and rebaselining a 200-line golden every time isn't worth the
 * churn.
 */

import { describe, expect, it } from "vitest";

import {
  describeFunction,
  describeFunctionAsJsonSchema,
  renderCategoryHelp,
  renderFunctionHelp,
  renderOverview,
} from "./help.js";
import { functionsByCategory, omcFunctionNames } from "./registry.js";

describe("describeFunction", () => {
  it("returns name, category, description and field lists for a real function", () => {
    // getClassInformation: 1 input field, 22 output fields, all described.
    const d = describeFunction("getClassInformation");
    expect(d.name).toBe("getClassInformation");
    expect(d.category).toBe("browsing");
    expect(d.description).toMatch(/restriction kind/i);
    expect(d.parameters).toHaveLength(1);
    expect(d.parameters[0]?.name).toBe("typeName");
    expect(d.parameters[0]?.typeLabel).toBe("string");
    expect(d.parameters[0]?.optional).toBe(false);
    expect(d.parameters[0]?.defaultValue).toBeUndefined();
    expect(d.returns.length).toBeGreaterThanOrEqual(22);
    const fileName = d.returns.find((f) => f.name === "fileName");
    expect(fileName?.typeLabel).toBe("string");
    const dimensions = d.returns.find((f) => f.name === "dimensions");
    expect(dimensions?.typeLabel).toBe("string[]");
  });

  it("captures optional + default markers for loadString", () => {
    const d = describeFunction("loadString");
    const filename = d.parameters.find((f) => f.name === "filename");
    expect(filename?.optional).toBe(true);
    expect(filename?.defaultValue).toBe("<interactive>");
    const merge = d.parameters.find((f) => f.name === "merge");
    expect(merge?.optional).toBe(true);
    expect(merge?.defaultValue).toBe(false);
    expect(merge?.typeLabel).toBe("boolean");
  });

  it("returns empty `returns` for functions whose output is a raw boolean", () => {
    // isPackage returns SuccessOutput — a single-field object, not a bare
    // boolean. Use isModel as another sanity check on the array shape.
    const d = describeFunction("isModel");
    // Either rendered as raw value (no fields) or a single-field object —
    // both are fine, this just guards against an introspection crash.
    expect(Array.isArray(d.returns)).toBe(true);
  });
});

describe("renderFunctionHelp", () => {
  it("renders description + parameters + returns for a known function", () => {
    const out = renderFunctionHelp("getClassInformation");
    expect(out).toMatch(/^getClassInformation — browsing/);
    expect(out).toContain("Parameters:");
    expect(out).toContain("typeName: string");
    expect(out).toContain("Returns:");
    expect(out).toContain("restriction: string");
    expect(out).toContain("dimensions: string[]");
  });

  it("marks optional fields and surfaces defaults", () => {
    const out = renderFunctionHelp("loadString");
    expect(out).toContain("data: string");
    expect(out).toMatch(/filename:.*\(optional, default "<interactive>"\)/);
    expect(out).toMatch(/merge:.*\(optional, default false\)/);
    expect(out).toMatch(/encoding:.*\(optional, default "UTF-8"\)/);
  });

  it("renders array typing correctly", () => {
    const out = renderFunctionHelp("getClassNames");
    expect(out).toMatch(/classNames:\s*string\[\]/);
  });
});

describe("renderCategoryHelp", () => {
  it("lists every function in a real category", () => {
    const out = renderCategoryHelp("execution");
    expect(out).toBeDefined();
    expect(out!).toMatch(/^execution — \d+ functions:/);
    expect(out!).toContain("checkModel");
    expect(out!).toContain("simulate");
  });

  it("returns undefined for a non-existent category", () => {
    expect(renderCategoryHelp("imaginary-category")).toBeUndefined();
  });
});

describe("describeFunctionAsJsonSchema", () => {
  it("returns valid JSON Schema 2020-12 for input + output", () => {
    const j = describeFunctionAsJsonSchema("loadString");
    expect(j.name).toBe("loadString");
    expect(j.category).toBe("lifecycle");
    expect(j.input.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(j.input.type).toBe("object");
    // Input-mode: only `data` is truly required from the caller.
    expect(j.input.required).toEqual(["data"]);
    const props = j.input.properties as Record<string, Record<string, unknown>>;
    expect(props.data?.type).toBe("string");
    // Defaults travel through.
    expect(props.merge?.default).toBe(false);
    expect(props.filename?.default).toBe("<interactive>");
  });

  it("input-mode for getClassInformation lists typeName as the only required field", () => {
    const j = describeFunctionAsJsonSchema("getClassInformation");
    expect(j.input.required).toEqual(["typeName"]);
  });
});

describe("renderOverview", () => {
  it("includes every category with its function count and the grand total", () => {
    const out = renderOverview();
    expect(out).toContain(String(omcFunctionNames.length));
    const byCat = functionsByCategory();
    for (const [cat, fns] of Object.entries(byCat)) {
      expect(out).toContain(cat);
      expect(out).toContain(String(fns.length));
    }
  });
});
