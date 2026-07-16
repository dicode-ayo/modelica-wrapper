/**
 * Tests for the ParameterModel producer.
 *
 * No OMC contact, no on-disk fixtures. `produceParameterModel` is a pure
 * function of `ModelInstance` (+ an optionally injected `UnitTable`), so we
 * synthesize minimal `ModelInstance` literals — round-tripped through
 * `ModelInstanceSchema` so a divergence between our hand-built shape and the
 * schema fails the test rather than the producer.
 *
 * Coverage mirrors the old `class-parameter-form` / `component-parameter-form`
 * tests plus the design-doc acceptance points:
 *  - parameter extraction across the extends chain (ancestors first, override)
 *  - instance-modifier-over-default precedence (component params)
 *  - Dialog group / tab / enable
 *  - base unit + displayUnit + fallback
 *  - inheritedFrom tagging (direct-base routing for class params)
 *  - unitOptions filling when a UnitTable is injected
 *  - collectBaseUnits
 */

import { describe, expect, it } from "vitest";

import {
  ModelInstanceSchema,
  type ModelInstance,
} from "../../_shared/modelInstance.js";
import {
  produceParameterModel,
  collectBaseUnits,
  type ParameterField,
  type UnitTable,
} from "./index.js";

/** Validate the synthetic instance against the schema before producing. */
function instance(elements: unknown[], name = "Test.Class"): ModelInstance {
  return ModelInstanceSchema.parse({
    name,
    restriction: "model",
    elements,
  });
}

/** A `Real` aliased through an SIunits-style `type` with a `unit` modifier. */
function siType(name: string, unit: string): unknown {
  return {
    name,
    restriction: "type",
    elements: [{ $kind: "extends", baseClass: "Real", modifiers: { unit } }],
  };
}

function fieldByName(
  model: { fields: ParameterField[] },
  name: string,
): ParameterField {
  const f = model.fields.find((x) => x.name === name);
  if (!f) throw new Error(`no field ${name}`);
  return f;
}

describe("produceParameterModel — class params", () => {
  it("emits no fields when there are no parameter components", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "x",
        type: "Real",
        prefixes: { variability: "" },
      },
    ]);
    const model = produceParameterModel(mi);
    expect(model.fields).toEqual([]);
    expect(model.className).toBe("Test.Class");
    expect(model.component).toBeUndefined();
  });

  it("emits a number field for a Real parameter (binding value, comment label)", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "driveAngle",
        type: siType("Modelica.Units.SI.Angle", "rad"),
        value: { binding: 1.5708 },
        prefixes: { variability: "parameter" },
        comment: "Reference distance to move",
      },
    ]);
    const f = fieldByName(produceParameterModel(mi), "driveAngle");
    expect(f.kind).toBe("number");
    expect(f.value).toBe(1.5708);
    expect(f.defaultValue).toBe(1.5708);
    expect(f.label).toBe("Reference distance to move");
    expect(f.unit).toBe("rad");
    expect(f.dialog).toEqual({ tab: "General", group: "Parameters" });
    expect(f.unitOptions).toEqual([]);
    expect(f.inheritedFrom).toBeUndefined();
  });

  it("falls back to the parameter name as the label when there's no comment", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "k",
        type: "Real",
        value: { binding: 1 },
        prefixes: { variability: "parameter" },
      },
    ]);
    expect(fieldByName(produceParameterModel(mi), "k").label).toBe("k");
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
    const f = fieldByName(produceParameterModel(mi), "useReset");
    expect(f.kind).toBe("boolean");
    expect(f.value).toBe(false);
  });

  it("emits an enum field with leaf choices + qualified type name", () => {
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
    const f = fieldByName(produceParameterModel(mi), "controllerType");
    expect(f.kind).toBe("enum");
    expect(f.enumChoices).toEqual(["P", "PI", "PD", "PID"]);
    expect(f.enumTypeName).toBe("Modelica.Blocks.Types.SimpleController");
    expect(f.value).toBe("PI");
    expect(f.defaultValue).toBe("PI");
  });

  it("emits an unsupported read-only field for record / complex parameter types", () => {
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
        type: { name: "Some.Record", restriction: "record", elements: [] },
        modifiers: { x: "1", y: "2" },
        prefixes: { variability: "parameter" },
      },
    ]);
    const model = produceParameterModel(mi);
    expect(model.fields.map((f) => f.name)).toEqual(["ok", "weird"]);
    const weird = fieldByName(model, "weird");
    expect(weird.kind).toBe("unsupported");
    expect(weird.dialog.tab).toBe("General");
    // The displayed value is the stringified current binding.
    expect(typeof weird.value).toBe("string");
  });

  it("carries the raw Dialog.enable AST when present, omits it otherwise", () => {
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
    const model = produceParameterModel(mi);
    expect(fieldByName(model, "y_reset").dialog.enable).toEqual(enableExpr);
    expect(fieldByName(model, "use_reset").dialog.enable).toBeUndefined();
    expect("enable" in fieldByName(model, "use_reset").dialog).toBe(false);
  });

  it("reads Dialog tab + group from the annotation, with spec defaults", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "k",
        type: "Real",
        value: { binding: 1 },
        prefixes: { variability: "parameter" },
        annotation: { Dialog: { tab: "Advanced", group: "Tuning" } },
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
    const model = produceParameterModel(mi);
    expect(fieldByName(model, "k").dialog).toEqual({
      tab: "Advanced",
      group: "Tuning",
    });
    expect(fieldByName(model, "Tstart").dialog).toEqual({
      tab: "General",
      group: "Initialization",
    });
    expect(fieldByName(model, "k2").dialog).toEqual({
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
    expect(fieldByName(produceParameterModel(mi), "T0").value).toBe(273.15);
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
    expect(fieldByName(produceParameterModel(mi), "yMin").value).toBe(-12);
  });

  it("carries the raw binding AST even when it cannot be coerced into value", () => {
    const binding = {
      $kind: "binary_op",
      op: "*",
      lhs: 2,
      rhs: { $kind: "cref", parts: [{ name: "pi" }] },
    };
    const mi = instance([
      {
        $kind: "component",
        name: "w",
        type: "Real",
        value: { binding },
        prefixes: { variability: "parameter" },
      },
    ]);
    const field = fieldByName(produceParameterModel(mi), "w");
    expect(field.value).toBeNull();
    expect(field.binding).toEqual(binding);
  });

  it("leaves binding absent when the declaration has none", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "k",
        type: "Real",
        prefixes: { variability: "parameter" },
      },
    ]);
    expect(fieldByName(produceParameterModel(mi), "k").binding).toBeUndefined();
  });
});

describe("produceParameterModel — extends chain + inheritedFrom", () => {
  it("surfaces a parameter declared on an ancestor via extends, tagged with the direct base", () => {
    const mi = instance(
      [
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
      "Test.Derived",
    );
    const f = fieldByName(produceParameterModel(mi), "k");
    expect(f.kind).toBe("number");
    expect(f.value).toBe(2);
    expect(f.inheritedFrom).toBe("Test.Base");
  });

  it("routes a 3-level inherited param to the host's DIRECT extends base (issue #76 item 3)", () => {
    const mi = instance(
      [
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
      "Test.C",
    );
    const f = fieldByName(produceParameterModel(mi), "k");
    expect(f.value).toBe(7);
    // The DIRECT clause on C is B — not the deep declaring A.
    expect(f.inheritedFrom).toBe("Test.B");
  });

  it("leaves inheritedFrom absent for a host-declared (own) parameter", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "k",
        type: "Real",
        value: { binding: 1 },
        prefixes: { variability: "parameter" },
      },
    ]);
    const f = fieldByName(produceParameterModel(mi), "k");
    expect(f.inheritedFrom).toBeUndefined();
    expect("inheritedFrom" in f).toBe(false);
  });

  it("when the host overrides an inherited param, the surviving field is the host's own", () => {
    const mi = instance(
      [
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
      "Test.Derived",
    );
    const model = produceParameterModel(mi);
    // Exactly one `k` field (override in place, not duplicated).
    expect(model.fields.filter((f) => f.name === "k")).toHaveLength(1);
    const f = fieldByName(model, "k");
    expect(f.value).toBe(7);
    expect(f.label).toBe("from Derived");
    expect(f.inheritedFrom).toBeUndefined();
  });

  it("preserves first-seen order across the chain when overriding", () => {
    // Base declares k then j; Derived overrides k and adds m. The override
    // keeps k in its original (first) position, m appended last.
    const mi = instance(
      [
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
              {
                $kind: "component",
                name: "j",
                type: "Real",
                value: { binding: 2 },
                prefixes: { variability: "parameter" },
              },
            ],
          },
        },
        {
          $kind: "component",
          name: "k",
          type: "Real",
          value: { binding: 9 },
          prefixes: { variability: "parameter" },
        },
        {
          $kind: "component",
          name: "m",
          type: "Real",
          value: { binding: 3 },
          prefixes: { variability: "parameter" },
        },
      ],
      "Test.Derived",
    );
    const model = produceParameterModel(mi);
    expect(model.fields.map((f) => f.name)).toEqual(["k", "j", "m"]);
    expect(fieldByName(model, "k").value).toBe(9);
    expect(fieldByName(model, "k").inheritedFrom).toBeUndefined();
  });
});

describe("produceParameterModel — component params", () => {
  /** A controller TYPE with `k` (default 1) and an inherited `useSupport`. */
  const controllerType = {
    name: "Lib.PI",
    restriction: "block",
    elements: [
      {
        $kind: "extends",
        baseClass: {
          name: "Lib.PartialBase",
          restriction: "block",
          elements: [
            {
              $kind: "component",
              name: "useSupport",
              type: "Boolean",
              value: { binding: true },
              prefixes: { variability: "parameter" },
            },
          ],
        },
      },
      {
        $kind: "component",
        name: "k",
        type: "Real",
        value: { binding: 1 },
        prefixes: { variability: "parameter" },
        comment: "Gain",
      },
    ],
  };

  it("uses the type default when no instance override is supplied", () => {
    const type = ModelInstanceSchema.parse(controllerType);
    const model = produceParameterModel(type, { component: "PI" });
    expect(model.component).toBe("PI");
    expect(model.className).toBe("Lib.PI");
    const k = fieldByName(model, "k");
    expect(k.value).toBe(1);
    expect(k.defaultValue).toBe(1);
    expect(k.label).toBe("Gain");
    // Inherited parameter is surfaced too.
    expect(fieldByName(model, "useSupport").value).toBe(true);
  });

  it("prefers the parent-class per-instance override over the type default", () => {
    const type = ModelInstanceSchema.parse(controllerType);
    const model = produceParameterModel(type, {
      component: "PI",
      componentOverrides: { k: "5", useSupport: "false" },
    });
    const k = fieldByName(model, "k");
    expect(k.value).toBe(5); // override
    expect(k.defaultValue).toBe(1); // type default still recorded
    expect(fieldByName(model, "useSupport").value).toBe(false);
  });

  it("reads the $value wrapper form of an override", () => {
    const type = ModelInstanceSchema.parse(controllerType);
    const model = produceParameterModel(type, {
      component: "PI",
      componentOverrides: { k: { $value: "3", final: true } },
    });
    expect(fieldByName(model, "k").value).toBe(3);
  });
});

describe("produceParameterModel — units", () => {
  it("pulls base unit + displayUnit from the AST; displayUnit falls back to source unit", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "phi",
        type: siType("Modelica.Units.SI.Angle", "rad"),
        modifiers: { displayUnit: '"deg"' },
        value: { binding: 1.5708 },
        prefixes: { variability: "parameter" },
      },
      {
        $kind: "component",
        name: "J",
        type: siType("Modelica.Units.SI.Inertia", "kg.m2"),
        value: { binding: 1 },
        prefixes: { variability: "parameter" },
      },
    ]);
    const model = produceParameterModel(mi);
    const phi = fieldByName(model, "phi");
    expect(phi.unit).toBe("rad");
    expect(phi.displayUnit).toBe("deg");
    const j = fieldByName(model, "J");
    expect(j.unit).toBe("kg.m2");
    // No displayUnit declared → key absent (form falls back to the source unit).
    expect(j.displayUnit).toBeUndefined();
    expect("displayUnit" in j).toBe(false);
  });

  it("walks a multi-level SI alias chain to reach the unit", () => {
    const inertiaType = {
      name: "Modelica.Units.SI.Inertia",
      restriction: "type",
      elements: [
        {
          $kind: "extends",
          baseClass: {
            name: "Modelica.Units.SI.MomentOfInertia",
            restriction: "type",
            elements: [
              {
                $kind: "extends",
                baseClass: "Real",
                modifiers: { unit: "kg.m2" },
              },
            ],
          },
        },
      ],
    };
    const mi = instance([
      {
        $kind: "component",
        name: "J",
        type: inertiaType,
        value: { binding: 1 },
        prefixes: { variability: "parameter" },
      },
    ]);
    expect(fieldByName(produceParameterModel(mi), "J").unit).toBe("kg.m2");
  });

  it("fills unitOptions from an injected UnitTable, keyed by base unit", () => {
    const unitTable: UnitTable = new Map([
      [
        "rad",
        [
          { unit: "rad", scaleFactor: 1, offset: 0 },
          { unit: "deg", scaleFactor: 0.017453292519943295, offset: 0 },
        ],
      ],
    ]);
    const mi = instance([
      {
        $kind: "component",
        name: "phi",
        type: siType("Modelica.Units.SI.Angle", "rad"),
        value: { binding: 1.5708 },
        prefixes: { variability: "parameter" },
      },
      {
        $kind: "component",
        name: "J",
        type: siType("Modelica.Units.SI.Inertia", "kg.m2"),
        value: { binding: 1 },
        prefixes: { variability: "parameter" },
      },
    ]);
    const model = produceParameterModel(mi, { unitTable });
    expect(fieldByName(model, "phi").unitOptions).toEqual([
      { unit: "rad", scaleFactor: 1, offset: 0 },
      { unit: "deg", scaleFactor: 0.017453292519943295, offset: 0 },
    ]);
    // No table entry for kg.m2 → empty list (static suffix on the form).
    expect(fieldByName(model, "J").unitOptions).toEqual([]);
  });

  it("leaves unitOptions empty when no table is injected", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "phi",
        type: siType("Modelica.Units.SI.Angle", "rad"),
        value: { binding: 1 },
        prefixes: { variability: "parameter" },
      },
    ]);
    expect(fieldByName(produceParameterModel(mi), "phi").unitOptions).toEqual(
      [],
    );
  });
});

describe("collectBaseUnits", () => {
  it("returns distinct base units, skipping empty and the dimensionless '1'", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "a",
        type: siType("Ang", "rad"),
        value: { binding: 1 },
        prefixes: { variability: "parameter" },
      },
      {
        $kind: "component",
        name: "b",
        type: siType("Ang2", "rad"),
        value: { binding: 1 },
        prefixes: { variability: "parameter" },
      },
      {
        $kind: "component",
        name: "j",
        type: siType("In", "kg.m2"),
        value: { binding: 1 },
        prefixes: { variability: "parameter" },
      },
      {
        $kind: "component",
        name: "n",
        type: siType("Dimless", "1"),
        value: { binding: 1 },
        prefixes: { variability: "parameter" },
      },
      {
        $kind: "component",
        name: "k",
        type: "Real",
        value: { binding: 1 },
        prefixes: { variability: "parameter" },
      },
    ]);
    const model = produceParameterModel(mi);
    expect(collectBaseUnits(model)).toEqual(["rad", "kg.m2"]);
  });

  it("returns [] for a model with no units", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "k",
        type: "Real",
        value: { binding: 1 },
        prefixes: { variability: "parameter" },
      },
    ]);
    expect(collectBaseUnits(produceParameterModel(mi))).toEqual([]);
  });
});
