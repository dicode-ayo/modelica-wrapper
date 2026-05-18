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
