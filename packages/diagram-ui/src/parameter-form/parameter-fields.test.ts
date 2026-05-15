/**
 * Unit tests for the JSON Schema → field list normaliser. Pure of any
 * DOM bits so vitest can run them without happy-dom.
 */

import { describe, expect, it } from "vitest";

import {
  initialValuesFromFields,
  isComplete,
  parameterFieldsFromSchema,
} from "./parameter-fields.js";

describe("parameterFieldsFromSchema — top-level vocabulary", () => {
  it("returns [] for non-object schemas", () => {
    expect(parameterFieldsFromSchema({ type: "string" })).toEqual([]);
    expect(parameterFieldsFromSchema({})).toEqual([]);
  });

  it("detects string / number / integer / boolean kinds", () => {
    const f = parameterFieldsFromSchema({
      type: "object",
      properties: {
        s: { type: "string" },
        n: { type: "number" },
        i: { type: "integer" },
        b: { type: "boolean" },
      },
    });
    expect(f.map((x) => [x.name, x.kind])).toEqual([
      ["s", "string"],
      ["n", "number"],
      ["i", "integer"],
      ["b", "boolean"],
    ]);
  });

  it("treats fields with `enum` as `enum` kind regardless of type", () => {
    const f = parameterFieldsFromSchema({
      type: "object",
      properties: {
        method: {
          type: "string",
          enum: ["dassl", "ida", "euler"],
        },
      },
    });
    expect(f).toHaveLength(1);
    expect(f[0]?.kind).toBe("enum");
    expect(f[0]?.enumValues).toEqual(["dassl", "ida", "euler"]);
  });

  it("flags arrays with their item kind", () => {
    const f = parameterFieldsFromSchema({
      type: "object",
      properties: {
        nums: { type: "array", items: { type: "number" } },
        names: { type: "array", items: { type: "string" } },
        any: { type: "array" }, // untyped items → fallback to string
      },
    });
    const byName = new Map(f.map((x) => [x.name, x]));
    expect(byName.get("nums")?.kind).toBe("array");
    expect(byName.get("nums")?.itemKind).toBe("number");
    expect(byName.get("names")?.itemKind).toBe("string");
    expect(byName.get("any")?.itemKind).toBe("string");
  });

  it("marks fields in `required` as required IFF they have no default", () => {
    const f = parameterFieldsFromSchema({
      type: "object",
      properties: {
        a: { type: "string" }, // required, no default
        b: { type: "string", default: "x" }, // listed required + default → optional from caller's POV
        c: { type: "string" }, // not required
      },
      required: ["a", "b"],
    });
    const byName = new Map(f.map((x) => [x.name, x]));
    expect(byName.get("a")?.required).toBe(true);
    expect(byName.get("b")?.required).toBe(false);
    expect(byName.get("c")?.required).toBe(false);
  });

  it("threads description + defaultValue through", () => {
    const f = parameterFieldsFromSchema({
      type: "object",
      properties: {
        stopTime: {
          type: "number",
          default: 1,
          description: "Simulation stop time.",
        },
      },
    });
    expect(f[0]?.description).toBe("Simulation stop time.");
    expect(f[0]?.defaultValue).toBe(1);
  });

  it("falls back to `unsupported` for nested objects or unfamiliar types", () => {
    const f = parameterFieldsFromSchema({
      type: "object",
      properties: {
        nested: { type: "object", properties: { x: { type: "string" } } },
        weird: { type: "null" as unknown as "string" },
        anyOf: { anyOf: [{ type: "string" }, { type: "number" }] },
      },
    });
    expect(f.find((x) => x.name === "nested")?.kind).toBe("unsupported");
    expect(f.find((x) => x.name === "weird")?.kind).toBe("unsupported");
    expect(f.find((x) => x.name === "anyOf")?.kind).toBe("unsupported");
  });

  it("preserves property iteration order", () => {
    const f = parameterFieldsFromSchema({
      type: "object",
      properties: {
        z: { type: "string" },
        a: { type: "string" },
        m: { type: "string" },
      },
    });
    expect(f.map((x) => x.name)).toEqual(["z", "a", "m"]);
  });
});

describe("initialValuesFromFields", () => {
  const fields = parameterFieldsFromSchema({
    type: "object",
    properties: {
      a: { type: "string" },
      b: { type: "number", default: 7 },
    },
  });

  it("uses initial values when provided", () => {
    expect(initialValuesFromFields(fields, { a: "hi", b: 99 })).toEqual({
      a: "hi",
      b: 99,
    });
  });

  it("falls back to schema defaults when initial is missing", () => {
    expect(initialValuesFromFields(fields, { a: "hi" })).toEqual({
      a: "hi",
      b: 7,
    });
  });

  it("returns undefined for fields with neither initial nor default", () => {
    expect(initialValuesFromFields(fields, {})).toEqual({
      a: undefined,
      b: 7,
    });
  });
});

describe("isComplete", () => {
  const fields = parameterFieldsFromSchema({
    type: "object",
    properties: {
      a: { type: "string" }, // required
      b: { type: "string", default: "x" }, // optional via default
    },
    required: ["a", "b"],
  });

  it("returns true when every required field has a value", () => {
    expect(isComplete(fields, { a: "hi" })).toBe(true);
  });

  it("returns false when a required field is missing / empty / null", () => {
    expect(isComplete(fields, {})).toBe(false);
    expect(isComplete(fields, { a: "" })).toBe(false);
    expect(isComplete(fields, { a: null })).toBe(false);
    expect(isComplete(fields, { a: undefined })).toBe(false);
  });

  it("ignores non-required fields", () => {
    // `b` is required-in-schema but has a default → not required from caller.
    expect(isComplete(fields, { a: "ok" })).toBe(true);
  });
});
