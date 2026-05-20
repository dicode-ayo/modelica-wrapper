import { describe, expect, it } from "vitest";
import type { ModelInstance } from "@modelica-wrapper/omc-client";

import {
  buildClassParameterForm,
  classParameterValueToExpr,
} from "./class-parameter-form.js";

/**
 * Helper: shape-checked enough to satisfy the typed walker without
 * making the test verbose. Tests target the shape we know OMC emits;
 * `as ModelInstance` is fine because the wrapper schemas already
 * validate the upstream payload.
 */
function instance(elements: unknown[]): ModelInstance {
  return {
    name: "Test.Class",
    restriction: "model",
    elements,
  } as unknown as ModelInstance;
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
    expect(form.schema).toEqual({
      type: "object",
      properties: {
        driveAngle: {
          type: "number",
          description: "Reference distance to move",
          "x-modelica-tab": "General",
          "x-modelica-group": "Parameters",
        },
      },
      required: ["driveAngle"],
    });
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
    expect(form.schema.properties).toEqual({
      useReset: {
        type: "boolean",
        "x-modelica-tab": "General",
        "x-modelica-group": "Parameters",
      },
    });
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
    expect(form.schema.properties).toEqual({
      controllerType: {
        type: "string",
        enum: ["P", "PI", "PD", "PID"],
        description: "Type of controller",
        "x-modelica-tab": "General",
        "x-modelica-group": "Parameters",
        "x-modelica-enum-type": "Modelica.Blocks.Types.SimpleController",
      },
    });
    expect(form.values).toEqual({ controllerType: "PI" });
    expect(form.refs.controllerType).toEqual({
      name: "controllerType",
      kind: "enum",
      enumTypeName: "Modelica.Blocks.Types.SimpleController",
      tab: "General",
      group: "Parameters",
    });
  });

  it("emits a read-only entry for record / unsupported parameter types so they're visible on the form", () => {
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
    expect(Object.keys(form.schema.properties ?? {})).toEqual(["ok", "weird"]);
    // The unsupported one has no `type` (so parameter-fields classifies
    // it as "unsupported"), keeps its Dialog metadata, and the displayed
    // value is the stringified current binding.
    const weird = form.schema.properties?.weird as Record<string, unknown>;
    expect(weird.type).toBeUndefined();
    expect(weird["x-modelica-tab"]).toBe("General");
    expect(form.refs.weird.kind).toBe("unsupported");
    // Unsupported entries must NOT be in `required` — the form's
    // submit button stays enabled even without editing them.
    expect(form.schema.required).toEqual(["ok"]);
  });

  it("stashes Dialog.enable expression on the schema for the form's evaluator", () => {
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
    const yReset = form.schema.properties?.y_reset as Record<string, unknown>;
    expect(yReset["x-modelica-enable"]).toEqual(enableExpr);
    // The other field has no enable expression so the key must be absent.
    const useReset = form.schema.properties?.use_reset as Record<string, unknown>;
    expect(useReset["x-modelica-enable"]).toBeUndefined();
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
    // Base class declares `k`; Derived purely extends Base and adds nothing.
    // Expected: the form built for Derived still has a `k` property.
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
    expect(form.schema.properties).toEqual({
      k: {
        type: "number",
        "x-modelica-tab": "General",
        "x-modelica-group": "Parameters",
      },
    });
    expect(form.values).toEqual({ k: 2 });
    expect(form.refs.k.kind).toBe("number");
    // The param is declared on the ancestor `Test.Base`, so its ref
    // carries `inheritedFrom` — the submit handler routes it through
    // `setExtendsModifierValue(host, "Test.Base", "k", expr)`.
    expect(form.refs.k.inheritedFrom).toBe("Test.Base");
  });

  it("routes a 3-level inherited param to the host's DIRECT extends base (issue #76, item 3)", () => {
    // C extends B extends A; `k` is declared on the deepest ancestor A.
    // setExtendsModifierValue(host, base, …) requires `base` to be a DIRECT
    // extends clause on the host. The direct clause on C is B — so the ref
    // must carry inheritedFrom === "Test.B", NOT the deep declaring "Test.A"
    // (which would emit setExtendsModifierValue(C, A, …) → no-op, edit lost).
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
    // The key must be absent (not just undefined) so own-param refs stay
    // clean on the wire and in equality checks.
    expect("inheritedFrom" in form.refs.k).toBe(false);
  });

  it("marks an inherited param but not an own param when the host adds its own", () => {
    // Base declares `k` (inherited); Derived adds its own `j`.
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
    // Both Base and Derived declare `k`. Last-write-wins means the host's
    // ref overwrites the inherited one — so the surviving ref must NOT be
    // tagged inherited (the modifier belongs on the host, not the extends
    // clause).
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
    // Both Base and Derived declare `k`; Derived's value wins. Use distinct
    // values + comments so the test fails loud if the inheritance walk
    // order ever flips.
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
    expect(
      (form.schema.properties?.k as { description?: string }).description,
    ).toBe("from Derived");
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
    expect(
      classParameterValueToExpr({ name: "k", kind: "number" }, 12.5),
    ).toBe("12.5");
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
    expect(
      classParameterValueToExpr({ name: "k", kind: "number" }, ""),
    ).toBe("");
  });
});
