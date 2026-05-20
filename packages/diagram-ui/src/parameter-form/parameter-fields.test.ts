/**
 * Unit tests for the JSON Schema → field list normaliser. Pure of any
 * DOM bits so vitest can run them without happy-dom.
 */

import { describe, expect, it } from "vitest";
import type { Expression } from "@modelica-wrapper/omc-client";

import {
  buildEnableScope,
  initialValuesFromFields,
  isComplete,
  isFieldEnabled,
  parameterFieldsFromSchema,
  type ParameterField,
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

describe("Dialog metadata pass-through", () => {
  it("reads `x-modelica-tab` and `x-modelica-group` onto the field", () => {
    const [f] = parameterFieldsFromSchema({
      type: "object",
      properties: {
        k: {
          type: "number",
          "x-modelica-tab": "Advanced",
          "x-modelica-group": "Tuning",
        } as never,
      },
    });
    expect(f?.tab).toBe("Advanced");
    expect(f?.group).toBe("Tuning");
  });

  it("leaves tab/group undefined when the schema doesn't set them (simulate form)", () => {
    const [f] = parameterFieldsFromSchema({
      type: "object",
      properties: { startTime: { type: "number", default: 0 } },
    });
    expect(f?.tab).toBeUndefined();
    expect(f?.group).toBeUndefined();
  });
});

describe("Dialog.enable evaluation — value fallback + commit cadence (#27)", () => {
  // `a > 0` as the AST `getModelInstance` emits for a Dialog.enable.
  const A_GT_ZERO: Expression = {
    $kind: "binary_op",
    op: ">",
    lhs: { $kind: "cref", parts: [{ name: "a" }] },
    rhs: 0,
  };

  /** Fields `a` (number, default 1) and `b` gated by `enable = a > 0`. */
  function gatedFields(): ParameterField[] {
    return parameterFieldsFromSchema({
      type: "object",
      properties: {
        a: { type: "number", default: 1 },
        b: { type: "number", "x-modelica-enable": A_GT_ZERO } as never,
      },
    });
  }

  function fieldB(fields: ParameterField[]): ParameterField {
    const b = fields.find((f) => f.name === "b");
    if (!b) throw new Error("missing field b");
    return b;
  }

  it("treats a field with no enable as always enabled", () => {
    const fields = parameterFieldsFromSchema({
      type: "object",
      properties: { a: { type: "number" } },
    });
    expect(isFieldEnabled(fields[0]!, fields, {})).toBe(true);
  });

  it("honours a literal `false` enable", () => {
    const fields = gatedFields();
    const b = { ...fieldB(fields), enable: false };
    expect(isFieldEnabled(b, fields, { a: 5 })).toBe(false);
  });

  it("enables the dependent field when the committed value satisfies the condition", () => {
    const fields = gatedFields();
    expect(isFieldEnabled(fieldB(fields), fields, { a: 5 })).toBe(true);
  });

  it("disables the dependent field when the committed value fails the condition", () => {
    const fields = gatedFields();
    expect(isFieldEnabled(fieldB(fields), fields, { a: -1 })).toBe(false);
  });

  it("falls back to the referenced field's class default when its value is cleared", () => {
    const fields = gatedFields();
    // `a` cleared (undefined) → falls back to default 1 → `a > 0` holds.
    expect(isFieldEnabled(fieldB(fields), fields, { a: undefined })).toBe(true);
    // Same when the working snapshot omits `a` entirely.
    expect(isFieldEnabled(fieldB(fields), fields, {})).toBe(true);
    // `null` is treated as cleared too.
    expect(isFieldEnabled(fieldB(fields), fields, { a: null })).toBe(true);
  });

  it("stays enabled (fallback:true) when neither value nor default resolves", () => {
    const fields = parameterFieldsFromSchema({
      type: "object",
      properties: {
        a: { type: "number" }, // no default
        b: { type: "number", "x-modelica-enable": A_GT_ZERO } as never,
      },
    });
    // Cref unresolved → evaluator's fallback:true keeps `b` enabled.
    expect(isFieldEnabled(fieldB(fields), fields, {})).toBe(true);
  });

  it("class default is shadowed by a committed value (binding wins over default)", () => {
    const fields = gatedFields();
    // Default would enable (1 > 0), but the committed -1 disables.
    expect(isFieldEnabled(fieldB(fields), fields, { a: -1 })).toBe(false);
  });

  it("commit cadence: the gate reads the committed snapshot, so an un-committed value does not change it", () => {
    // The component keeps a live `working` set updated on every keystroke
    // but only refreshes the `committed` snapshot on focus-out. This test
    // models that contract at the scope level: `isFieldEnabled` sees only
    // what's in the committed snapshot it's given. A failing value typed
    // but not yet committed (still { a: 5 } in `committed`) keeps `b`
    // enabled; once committed ({ a: -1 }) it disables.
    const fields = gatedFields();
    const committedBeforeBlur = { a: 5 }; // last committed value
    expect(isFieldEnabled(fieldB(fields), fields, committedBeforeBlur)).toBe(
      true,
    );
    const committedAfterBlur = { a: -1 }; // focus-out refreshes the snapshot
    expect(isFieldEnabled(fieldB(fields), fields, committedAfterBlur)).toBe(
      false,
    );
  });

  it("qualifies enum working values against the field's enum type for equality", () => {
    const fields = parameterFieldsFromSchema({
      type: "object",
      properties: {
        controllerType: {
          type: "string",
          enum: ["P", "PI"],
          "x-modelica-enum-type": "Modelica.Blocks.Types.SimpleController",
        } as never,
        ki: {
          type: "number",
          "x-modelica-enable": {
            $kind: "binary_op",
            op: "==",
            lhs: { $kind: "cref", parts: [{ name: "controllerType" }] },
            rhs: {
              $kind: "enum",
              name: "Modelica.Blocks.Types.SimpleController.PI",
            },
          },
        } as never,
      },
    });
    const ki = fields.find((f) => f.name === "ki")!;
    expect(isFieldEnabled(ki, fields, { controllerType: "PI" })).toBe(true);
    expect(isFieldEnabled(ki, fields, { controllerType: "P" })).toBe(false);
  });

  it("strips a cref prefix so sub-component expressions resolve against bare names", () => {
    const fields = gatedFields();
    const prefixedEnable: Expression = {
      $kind: "binary_op",
      op: ">",
      lhs: { $kind: "cref", parts: [{ name: "PI" }, { name: "a" }] },
      rhs: 0,
    };
    const b = { ...fieldB(fields), enable: prefixedEnable };
    // `PI.a` strips to `a`, resolving against the form's `a` working value.
    expect(isFieldEnabled(b, fields, { a: 5 }, "PI")).toBe(true);
    expect(isFieldEnabled(b, fields, { a: -1 }, "PI")).toBe(false);
  });

  it("buildEnableScope resolves a cref to the value, then the default", () => {
    const fields = gatedFields();
    // committed value present → that value
    expect(buildEnableScope(fields, { a: 9 }).lookup(["a"])).toBe(9);
    // cleared → class default
    expect(buildEnableScope(fields, {}).lookup(["a"])).toBe(1);
  });
});
