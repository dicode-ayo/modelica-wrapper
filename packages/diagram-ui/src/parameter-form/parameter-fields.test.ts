/**
 * Unit tests for the `ParameterModel` → field-list normaliser + the form's
 * value/enable helpers. Pure of any DOM bits so vitest runs them without
 * happy-dom.
 */

import { describe, expect, it } from "vitest";
import type {
  Expression,
  ParameterField as ModelField,
  ParameterModel,
} from "@dicode/omc-client";

import {
  buildEnableScope,
  enabledValues,
  initialValuesFromFields,
  isComplete,
  isFieldEnabled,
  parameterFieldsFromModel,
  type ParameterField,
} from "./parameter-fields.js";

/** Build a `ParameterField` (omc-client shape) with sensible defaults. */
function modelField(over: Partial<ModelField> & { name: string }): ModelField {
  return {
    label: over.name,
    kind: "number",
    value: null,
    dialog: { tab: "General", group: "Parameters" },
    unitOptions: [],
    ...over,
  } as ModelField;
}

/** Wrap fields into a `ParameterModel`. */
function model(fields: Array<Partial<ModelField> & { name: string }>): ParameterModel {
  return { className: "T", fields: fields.map(modelField) };
}

describe("parameterFieldsFromModel — kinds + vocabulary", () => {
  it("returns [] for an empty model", () => {
    expect(parameterFieldsFromModel(model([]))).toEqual([]);
  });

  it("maps string / number / integer / boolean kinds", () => {
    const f = parameterFieldsFromModel(
      model([
        { name: "s", kind: "string" },
        { name: "n", kind: "number" },
        { name: "i", kind: "integer" },
        { name: "b", kind: "boolean" },
      ]),
    );
    expect(f.map((x) => [x.name, x.kind])).toEqual([
      ["s", "string"],
      ["n", "number"],
      ["i", "integer"],
      ["b", "boolean"],
    ]);
  });

  it("maps enum fields and threads enumChoices into enumValues", () => {
    const f = parameterFieldsFromModel(
      model([{ name: "method", kind: "enum", enumChoices: ["dassl", "ida", "euler"] }]),
    );
    expect(f).toHaveLength(1);
    expect(f[0]?.kind).toBe("enum");
    expect(f[0]?.enumValues).toEqual(["dassl", "ida", "euler"]);
  });

  it("marks editable fields required and unsupported fields not required", () => {
    const f = parameterFieldsFromModel(
      model([
        { name: "a", kind: "number" },
        { name: "rec", kind: "unsupported", value: "Record(...)" },
      ]),
    );
    const byName = new Map(f.map((x) => [x.name, x]));
    expect(byName.get("a")?.required).toBe(true);
    expect(byName.get("rec")?.required).toBe(false);
  });

  it("threads unit / displayUnit / unitOptions from the model field", () => {
    const f = parameterFieldsFromModel(
      model([
        {
          name: "phi",
          kind: "number",
          unit: "rad",
          displayUnit: "deg",
          unitOptions: [
            { unit: "rad", scaleFactor: 1, offset: 0 },
            { unit: "deg", scaleFactor: 0.017453292519943295, offset: 0 },
          ],
        },
        {
          name: "J",
          kind: "number",
          unit: "kg.m2",
          unitOptions: [{ unit: "kg.m2", scaleFactor: 1, offset: 0 }],
        },
        { name: "plain", kind: "number" },
      ]),
    );
    const byName = new Map(f.map((x) => [x.name, x]));
    const phi = byName.get("phi")!;
    expect(phi.unit).toBe("rad");
    expect(phi.displayUnit).toBe("deg");
    expect(phi.unitOptions).toEqual([
      { unit: "rad", scaleFactor: 1, offset: 0 },
      { unit: "deg", scaleFactor: 0.017453292519943295, offset: 0 },
    ]);
    const j = byName.get("J")!;
    expect(j.unit).toBe("kg.m2");
    expect(j.displayUnit).toBeUndefined();
    expect(j.unitOptions).toEqual([{ unit: "kg.m2", scaleFactor: 1, offset: 0 }]);
    const plain = byName.get("plain")!;
    expect(plain.unit).toBeUndefined();
    expect(plain.unitOptions).toEqual([]);
  });

  it("uses the comment as description, omitting it when it equals the name", () => {
    const f = parameterFieldsFromModel(
      model([
        { name: "stopTime", kind: "number", label: "Simulation stop time.", value: 1, defaultValue: 1 },
        { name: "k", kind: "number", label: "k" },
      ]),
    );
    const byName = new Map(f.map((x) => [x.name, x]));
    expect(byName.get("stopTime")?.description).toBe("Simulation stop time.");
    expect(byName.get("stopTime")?.defaultValue).toBe(1);
    expect(byName.get("k")?.description).toBeUndefined();
  });

  it("threads the resolved value (instance modifier over default)", () => {
    const f = parameterFieldsFromModel(
      model([{ name: "k", kind: "number", value: 12, defaultValue: 1 }]),
    );
    expect(f[0]?.value).toBe(12);
    expect(f[0]?.defaultValue).toBe(1);
  });

  it("normalises a null value to undefined", () => {
    const f = parameterFieldsFromModel(model([{ name: "k", kind: "number", value: null }]));
    expect(f[0]?.value).toBeUndefined();
  });

  it("preserves field order", () => {
    const f = parameterFieldsFromModel(
      model([
        { name: "z", kind: "string" },
        { name: "a", kind: "string" },
        { name: "m", kind: "string" },
      ]),
    );
    expect(f.map((x) => x.name)).toEqual(["z", "a", "m"]);
  });
});

describe("initialValuesFromFields", () => {
  it("uses the field's resolved value", () => {
    const fields = parameterFieldsFromModel(
      model([
        { name: "a", kind: "string", value: "hi" },
        { name: "b", kind: "number", value: 99, defaultValue: 7 },
      ]),
    );
    expect(initialValuesFromFields(fields)).toEqual({ a: "hi", b: 99 });
  });

  it("falls back to the type default when value is unset", () => {
    const fields = parameterFieldsFromModel(
      model([
        { name: "a", kind: "string", value: "hi" },
        { name: "b", kind: "number", value: null, defaultValue: 7 },
      ]),
    );
    expect(initialValuesFromFields(fields)).toEqual({ a: "hi", b: 7 });
  });

  it("returns undefined for fields with neither value nor default", () => {
    const fields = parameterFieldsFromModel(
      model([
        { name: "a", kind: "string", value: null },
        { name: "b", kind: "number", value: null, defaultValue: 7 },
      ]),
    );
    expect(initialValuesFromFields(fields)).toEqual({ a: undefined, b: 7 });
  });
});

describe("isComplete", () => {
  const fields = parameterFieldsFromModel(
    model([
      { name: "a", kind: "string" },
      { name: "b", kind: "string", value: "x" },
    ]),
  );

  it("returns true when every required field has a value", () => {
    expect(isComplete(fields, { a: "hi", b: "x" })).toBe(true);
  });

  it("returns false when a required field is missing / empty / null", () => {
    expect(isComplete(fields, { b: "x" })).toBe(false);
    expect(isComplete(fields, { a: "", b: "x" })).toBe(false);
    expect(isComplete(fields, { a: null, b: "x" })).toBe(false);
    expect(isComplete(fields, { a: undefined, b: "x" })).toBe(false);
  });

  it("ignores a DISABLED required field even if it is empty (issue #76, item 17)", () => {
    const gated = parameterFieldsFromModel(
      model([
        { name: "gain", kind: "number" },
        {
          name: "Ti",
          kind: "number",
          dialog: {
            tab: "General",
            group: "Parameters",
            enable: {
              $kind: "binary_op",
              op: ">",
              lhs: { $kind: "cref", parts: [{ name: "gain" }] },
              rhs: 0,
            } as never,
          },
        },
      ]),
    );
    // Ti enabled (gain > 0) and empty → incomplete.
    expect(isComplete(gated, { gain: 5, Ti: undefined })).toBe(false);
    // Ti disabled (gain <= 0) and empty → still complete (Ti is skipped).
    expect(isComplete(gated, { gain: -1, Ti: undefined })).toBe(true);
    // Ti enabled and filled → complete.
    expect(isComplete(gated, { gain: 5, Ti: 0.5 })).toBe(true);
  });
});

describe("enabledValues (issue #76, item 4)", () => {
  // controllerType picker; Ti only enabled when controllerType != "P".
  function pidFields(): ParameterField[] {
    return parameterFieldsFromModel(
      model([
        { name: "controllerType", kind: "enum", enumChoices: ["P", "PI"] },
        { name: "k", kind: "number" },
        {
          name: "Ti",
          kind: "number",
          dialog: {
            tab: "General",
            group: "Parameters",
            enable: {
              $kind: "binary_op",
              op: "<>",
              lhs: { $kind: "cref", parts: [{ name: "controllerType" }] },
              rhs: "P",
            } as never,
          },
        },
      ]),
    );
  }

  it("keeps all values when every field is enabled", () => {
    const fields = pidFields();
    expect(
      enabledValues(fields, { controllerType: "PI", k: 2, Ti: 0.5 }),
    ).toEqual({ controllerType: "PI", k: 2, Ti: 0.5 });
  });

  it("drops a disabled field's stale value from the submitted set", () => {
    const fields = pidFields();
    const submitted = enabledValues(fields, {
      controllerType: "P",
      k: 2,
      Ti: 0.5,
    });
    expect(submitted).toEqual({ controllerType: "P", k: 2 });
    expect("Ti" in submitted).toBe(false);
  });

  it("always keeps fields that have no enable condition", () => {
    const fields = parameterFieldsFromModel(
      model([
        { name: "a", kind: "number" },
        { name: "b", kind: "string" },
      ]),
    );
    expect(enabledValues(fields, { a: 1, b: "x" })).toEqual({ a: 1, b: "x" });
  });
});

describe("Dialog metadata pass-through", () => {
  it("reads tab and group off the model field's dialog", () => {
    const [f] = parameterFieldsFromModel(
      model([{ name: "k", kind: "number", dialog: { tab: "Advanced", group: "Tuning" } }]),
    );
    expect(f?.tab).toBe("Advanced");
    expect(f?.group).toBe("Tuning");
  });

  it("carries the producer's default tab/group", () => {
    const [f] = parameterFieldsFromModel(model([{ name: "startTime", kind: "number", value: 0 }]));
    expect(f?.tab).toBe("General");
    expect(f?.group).toBe("Parameters");
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
    return parameterFieldsFromModel(
      model([
        { name: "a", kind: "number", value: 1, defaultValue: 1 },
        {
          name: "b",
          kind: "number",
          dialog: { tab: "General", group: "Parameters", enable: A_GT_ZERO },
        },
      ]),
    );
  }

  function fieldB(fields: ParameterField[]): ParameterField {
    const b = fields.find((f) => f.name === "b");
    if (!b) throw new Error("missing field b");
    return b;
  }

  it("treats a field with no enable as always enabled", () => {
    const fields = parameterFieldsFromModel(model([{ name: "a", kind: "number" }]));
    expect(isFieldEnabled(fields[0]!, fields, {})).toBe(true);
  });

  it("honours a literal `false` enable", () => {
    const fields = gatedFields();
    const b = { ...fieldB(fields), enable: false as unknown as Expression };
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
    expect(isFieldEnabled(fieldB(fields), fields, { a: undefined })).toBe(true);
    expect(isFieldEnabled(fieldB(fields), fields, {})).toBe(true);
    expect(isFieldEnabled(fieldB(fields), fields, { a: null })).toBe(true);
  });

  it("stays enabled (fallback:true) when neither value nor default resolves", () => {
    const fields = parameterFieldsFromModel(
      model([
        { name: "a", kind: "number" },
        {
          name: "b",
          kind: "number",
          dialog: { tab: "General", group: "Parameters", enable: A_GT_ZERO },
        },
      ]),
    );
    expect(isFieldEnabled(fieldB(fields), fields, {})).toBe(true);
  });

  it("class default is shadowed by a committed value (binding wins over default)", () => {
    const fields = gatedFields();
    expect(isFieldEnabled(fieldB(fields), fields, { a: -1 })).toBe(false);
  });

  it("commit cadence: the gate reads the committed snapshot", () => {
    const fields = gatedFields();
    expect(isFieldEnabled(fieldB(fields), fields, { a: 5 })).toBe(true);
    expect(isFieldEnabled(fieldB(fields), fields, { a: -1 })).toBe(false);
  });

  it("qualifies enum working values against the field's enum type for equality", () => {
    const fields = parameterFieldsFromModel(
      model([
        {
          name: "controllerType",
          kind: "enum",
          enumChoices: ["P", "PI"],
          enumTypeName: "Modelica.Blocks.Types.SimpleController",
        },
        {
          name: "ki",
          kind: "number",
          dialog: {
            tab: "General",
            group: "Parameters",
            enable: {
              $kind: "binary_op",
              op: "==",
              lhs: { $kind: "cref", parts: [{ name: "controllerType" }] },
              rhs: {
                $kind: "enum",
                name: "Modelica.Blocks.Types.SimpleController.PI",
              },
            } as never,
          },
        },
      ]),
    );
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
    expect(isFieldEnabled(b, fields, { a: 5 }, "PI")).toBe(true);
    expect(isFieldEnabled(b, fields, { a: -1 }, "PI")).toBe(false);
  });

  it("buildEnableScope resolves a cref to the value, then the default", () => {
    const fields = gatedFields();
    expect(buildEnableScope(fields, { a: 9 }).lookup(["a"])).toBe(9);
    expect(buildEnableScope(fields, {}).lookup(["a"])).toBe(1);
  });
});
