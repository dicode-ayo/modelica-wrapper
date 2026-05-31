import { describe, expect, it } from "vitest";
import type { ModelInstance, ParameterField } from "@dicode/omc-client";

import {
  buildClassParameterForm,
  classParameterValueToExpr,
} from "./parameter-edits.js";

/**
 * Helper: shape-checked enough to satisfy the typed walker without
 * making the test verbose. Tests target the shape we know OMC emits;
 * `as ModelInstance` is fine because the wrapper schemas already
 * validate the upstream payload.
 *
 * These tests focus on what `parameter-edits.ts` owns on top of the pure
 * `produceParameterModel` (covered exhaustively in omc-client's
 * `producer.test.ts`): the `{ model, values, refs }` submit state — the
 * model the webview renders, the initial submit-diff values, and the per-field
 * `ParameterRef`s the submit handler routes writes with.
 */
function instance(elements: unknown[]): ModelInstance {
  return {
    name: "Test.Class",
    restriction: "model",
    elements,
  } as unknown as ModelInstance;
}

function field(
  model: { fields: ParameterField[] },
  name: string,
): ParameterField {
  const f = model.fields.find((x) => x.name === name);
  if (!f) throw new Error(`no field ${name}`);
  return f;
}

describe("buildClassParameterForm", () => {
  it("returns undefined when no parameter components are present", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "x",
        type: "Real",
        prefixes: { variability: "" },
      },
    ]);
    expect(buildClassParameterForm(mi)).toBeUndefined();
  });

  it("emits a number field for a Real parameter aliased through a SIunits type", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "driveAngle",
        type: {
          name: "Modelica.Units.SI.Angle",
          restriction: "type",
          elements: [{ $kind: "extends", baseClass: "Real" }],
        },
        value: { binding: 1.5708 },
        prefixes: { variability: "parameter" },
        comment: "Reference distance to move",
      },
    ]);
    const form = buildClassParameterForm(mi)!;
    const f = field(form.model, "driveAngle");
    expect(f.kind).toBe("number");
    expect(f.value).toBe(1.5708);
    expect(f.label).toBe("Reference distance to move");
    expect(f.dialog).toEqual({ tab: "General", group: "Parameters" });
    expect(form.values).toEqual({ driveAngle: 1.5708 });
    expect(form.refs.driveAngle).toEqual({
      name: "driveAngle",
      kind: "number",
      tab: "General",
      group: "Parameters",
    });
  });

  it("emits a boolean field for a Boolean parameter", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "useReset",
        type: "Boolean",
        value: { binding: false },
        prefixes: { variability: "parameter" },
      },
    ]);
    const form = buildClassParameterForm(mi)!;
    expect(field(form.model, "useReset").kind).toBe("boolean");
    expect(form.values).toEqual({ useReset: false });
    expect(form.refs.useReset.kind).toBe("boolean");
  });

  it("emits an enum picker for an enumeration-typed parameter", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "controllerType",
        type: {
          name: "Modelica.Blocks.Types.SimpleController",
          restriction: "type",
          elements: [
            { $kind: "extends", baseClass: "enumeration" },
            { $kind: "component", name: "P" },
            { $kind: "component", name: "PI" },
            { $kind: "component", name: "PD" },
            { $kind: "component", name: "PID" },
          ],
        },
        value: {
          binding: {
            $kind: "enum",
            name: "Modelica.Blocks.Types.SimpleController.PI",
            index: 2,
          },
        },
        prefixes: { variability: "parameter" },
        comment: "Type of controller",
      },
    ]);
    const form = buildClassParameterForm(mi)!;
    const f = field(form.model, "controllerType");
    expect(f.kind).toBe("enum");
    expect(f.enumChoices).toEqual(["P", "PI", "PD", "PID"]);
    expect(f.enumTypeName).toBe("Modelica.Blocks.Types.SimpleController");
    expect(form.values).toEqual({ controllerType: "PI" });
    expect(form.refs.controllerType).toEqual({
      name: "controllerType",
      kind: "enum",
      enumTypeName: "Modelica.Blocks.Types.SimpleController",
      tab: "General",
      group: "Parameters",
    });
  });

  it("emits a read-only field for record / unsupported parameter types so they're visible on the form", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "ok",
        type: "Real",
        value: { binding: 1 },
        prefixes: { variability: "parameter" },
      },
      {
        $kind: "component",
        name: "weird",
        type: {
          name: "Some.Record",
          restriction: "record",
          elements: [],
        },
        modifiers: { x: "1", y: "2" },
        prefixes: { variability: "parameter" },
      },
    ]);
    const form = buildClassParameterForm(mi)!;
    expect(form.model.fields.map((f) => f.name)).toEqual(["ok", "weird"]);
    expect(field(form.model, "weird").kind).toBe("unsupported");
    expect(form.refs.weird.kind).toBe("unsupported");
  });

  it("carries the Dialog.enable expression on the model field for the form's evaluator", () => {
    const enableExpr = {
      $kind: "binary_op" as const,
      op: "==",
      lhs: { $kind: "cref" as const, parts: [{ name: "use_reset" }] },
      rhs: true,
    };
    const mi = instance([
      {
        $kind: "component",
        name: "use_reset",
        type: "Boolean",
        value: { binding: false },
        prefixes: { variability: "parameter" },
      },
      {
        $kind: "component",
        name: "y_reset",
        type: "Real",
        value: { binding: 0 },
        prefixes: { variability: "parameter" },
        annotation: { Dialog: { enable: enableExpr } },
      },
    ]);
    const form = buildClassParameterForm(mi)!;
    expect(field(form.model, "y_reset").dialog.enable).toEqual(enableExpr);
    // The other field has no enable expression so the key must be absent.
    expect(field(form.model, "use_reset").dialog.enable).toBeUndefined();
  });

  it("reads Dialog tab + group from the annotation when present", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "k",
        type: "Real",
        value: { binding: 1 },
        prefixes: { variability: "parameter" },
        annotation: {
          Dialog: { tab: "Advanced", group: "Tuning" },
        },
      },
      {
        $kind: "component",
        name: "Tstart",
        type: "Real",
        value: { binding: 0 },
        prefixes: { variability: "parameter" },
        annotation: { Dialog: { group: "Initialization" } },
      },
      {
        $kind: "component",
        name: "k2",
        type: "Real",
        value: { binding: 2 },
        prefixes: { variability: "parameter" },
      },
    ]);
    const form = buildClassParameterForm(mi)!;
    expect(form.refs.k).toMatchObject({ tab: "Advanced", group: "Tuning" });
    expect(form.refs.Tstart).toMatchObject({
      tab: "General",
      group: "Initialization",
    });
    expect(form.refs.k2).toMatchObject({
      tab: "General",
      group: "Parameters",
    });
  });

  it("falls back to the user-written modifier expression when value isn't pre-evaluated", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "T0",
        type: "Real",
        modifiers: "273.15",
        prefixes: { variability: "parameter" },
      },
    ]);
    const form = buildClassParameterForm(mi)!;
    expect(form.values).toEqual({ T0: 273.15 });
  });

  it("surfaces parameters declared on an ancestor via extends", () => {
    const mi: ModelInstance = {
      name: "Test.Derived",
      restriction: "model",
      elements: [
        {
          $kind: "extends",
          baseClass: {
            name: "Test.Base",
            restriction: "model",
            elements: [
              {
                $kind: "component",
                name: "k",
                type: "Real",
                value: { binding: 2 },
                prefixes: { variability: "parameter" },
              },
            ],
          },
        },
      ],
    } as unknown as ModelInstance;
    const form = buildClassParameterForm(mi)!;
    expect(form.model.fields.map((f) => f.name)).toEqual(["k"]);
    expect(field(form.model, "k").kind).toBe("number");
    expect(form.values).toEqual({ k: 2 });
    expect(form.refs.k.kind).toBe("number");
    // The param is declared on the ancestor `Test.Base`, so its ref
    // carries `inheritedFrom` — the submit handler routes it through
    // `setExtendsModifierValue(host, "Test.Base", "k", expr)`.
    expect(form.refs.k.inheritedFrom).toBe("Test.Base");
  });

  it("routes a 3-level inherited param to the host's DIRECT extends base (issue #76, item 3)", () => {
    const mi: ModelInstance = {
      name: "Test.C",
      restriction: "model",
      elements: [
        {
          $kind: "extends",
          baseClass: {
            name: "Test.B",
            restriction: "model",
            elements: [
              {
                $kind: "extends",
                baseClass: {
                  name: "Test.A",
                  restriction: "model",
                  elements: [
                    {
                      $kind: "component",
                      name: "k",
                      type: "Real",
                      value: { binding: 7 },
                      prefixes: { variability: "parameter" },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    } as unknown as ModelInstance;
    const form = buildClassParameterForm(mi)!;
    expect(form.refs.k.kind).toBe("number");
    expect(form.values).toEqual({ k: 7 });
    expect(form.refs.k.inheritedFrom).toBe("Test.B");
  });

  it("leaves inheritedFrom unset for a host-declared (own) parameter", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "k",
        type: "Real",
        value: { binding: 1 },
        prefixes: { variability: "parameter" },
      },
    ]);
    const form = buildClassParameterForm(mi)!;
    expect(form.refs.k.inheritedFrom).toBeUndefined();
    expect("inheritedFrom" in form.refs.k).toBe(false);
  });

  it("marks an inherited param but not an own param when the host adds its own", () => {
    const mi: ModelInstance = {
      name: "Test.Derived",
      restriction: "model",
      elements: [
        {
          $kind: "extends",
          baseClass: {
            name: "Test.Base",
            restriction: "model",
            elements: [
              {
                $kind: "component",
                name: "k",
                type: "Real",
                value: { binding: 2 },
                prefixes: { variability: "parameter" },
              },
            ],
          },
        },
        {
          $kind: "component",
          name: "j",
          type: "Real",
          value: { binding: 3 },
          prefixes: { variability: "parameter" },
        },
      ],
    } as unknown as ModelInstance;
    const form = buildClassParameterForm(mi)!;
    expect(form.refs.k.inheritedFrom).toBe("Test.Base");
    expect(form.refs.j.inheritedFrom).toBeUndefined();
  });

  it("when the host overrides an inherited param, the surviving ref is the host's own (no inheritedFrom)", () => {
    const mi: ModelInstance = {
      name: "Test.Derived",
      restriction: "model",
      elements: [
        {
          $kind: "extends",
          baseClass: {
            name: "Test.Base",
            restriction: "model",
            elements: [
              {
                $kind: "component",
                name: "k",
                type: "Real",
                value: { binding: 1 },
                prefixes: { variability: "parameter" },
              },
            ],
          },
        },
        {
          $kind: "component",
          name: "k",
          type: "Real",
          value: { binding: 7 },
          prefixes: { variability: "parameter" },
        },
      ],
    } as unknown as ModelInstance;
    const form = buildClassParameterForm(mi)!;
    expect(form.refs.k.inheritedFrom).toBeUndefined();
  });

  it("host-class parameter overrides an ancestor's same-named parameter (last-write-wins)", () => {
    const mi: ModelInstance = {
      name: "Test.Derived",
      restriction: "model",
      elements: [
        {
          $kind: "extends",
          baseClass: {
            name: "Test.Base",
            restriction: "model",
            elements: [
              {
                $kind: "component",
                name: "k",
                type: "Real",
                value: { binding: 1 },
                prefixes: { variability: "parameter" },
                comment: "from Base",
              },
            ],
          },
        },
        {
          $kind: "component",
          name: "k",
          type: "Real",
          value: { binding: 7 },
          prefixes: { variability: "parameter" },
          comment: "from Derived",
        },
      ],
    } as unknown as ModelInstance;
    const form = buildClassParameterForm(mi)!;
    expect(form.values).toEqual({ k: 7 });
    expect(field(form.model, "k").label).toBe("from Derived");
  });

  it("prefers the evaluated literal when the binding is a complex expression", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "yMin",
        type: "Real",
        value: {
          binding: {
            $kind: "unary_op",
            op: "-",
            exp: { $kind: "cref", parts: [{ name: "yMax" }] },
          },
          value: -12,
        },
        prefixes: { variability: "parameter" },
      },
    ]);
    const form = buildClassParameterForm(mi)!;
    expect(form.values).toEqual({ yMin: -12 });
  });
});

describe("classParameterValueToExpr", () => {
  it("emits unquoted literals for numeric and boolean values", () => {
    expect(classParameterValueToExpr({ name: "k", kind: "number" }, 12.5)).toBe(
      "12.5",
    );
    expect(
      classParameterValueToExpr({ name: "use", kind: "boolean" }, true),
    ).toBe("true");
    expect(
      classParameterValueToExpr({ name: "use", kind: "boolean" }, false),
    ).toBe("false");
  });

  it("quotes string values and escapes embedded quotes / backslashes", () => {
    expect(
      classParameterValueToExpr(
        { name: "label", kind: "string" },
        `she said "hi" \\ ok`,
      ),
    ).toBe(`"she said \\"hi\\" \\\\ ok"`);
  });

  it("emits qualified enum literals", () => {
    expect(
      classParameterValueToExpr(
        {
          name: "controllerType",
          kind: "enum",
          enumTypeName: "Modelica.Blocks.Types.SimpleController",
        },
        "PI",
      ),
    ).toBe("Modelica.Blocks.Types.SimpleController.PI");
  });

  it("returns empty string when value is cleared, so the caller can drop the modifier", () => {
    expect(
      classParameterValueToExpr({ name: "k", kind: "number" }, undefined),
    ).toBe("");
    expect(classParameterValueToExpr({ name: "k", kind: "number" }, "")).toBe(
      "",
    );
  });
});
