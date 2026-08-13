import { describe, expect, it } from "vitest";
import type { ComponentElement, ParameterField } from "@dicode/omc-client";

import { refOf } from "../../test-support/parameter-refs.js";
import {
  buildComponentParameterForm,
  componentParameterEditPlan,
  componentParameterElementName,
  componentParameterValueToExpr,
  type ComponentParameterRef,
} from "./parameter-edits.js";

function field(
  model: { fields: ParameterField[] },
  name: string,
): ParameterField {
  const f = model.fields.find((x) => x.name === name);
  if (!f) throw new Error(`no field ${name}`);
  return f;
}

/**
 * Builds the kind of `ComponentElement` `getModelInstance` emits for a
 * sub-component on the host class — a `component` node whose `type` is
 * a nested `ModelInstance` declaring the sub-component's parameters.
 */
function pi(modifiers?: Record<string, unknown>): ComponentElement {
  return {
    $kind: "component",
    name: "PI",
    modifiers: modifiers as never,
    type: {
      name: "Modelica.Blocks.Continuous.LimPID",
      restriction: "block",
      elements: [
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
              name: "Modelica.Blocks.Types.SimpleController.PID",
              index: 4,
            },
          },
          prefixes: { variability: "parameter" },
          comment: "Type of controller",
        },
        {
          $kind: "component",
          name: "k",
          type: "Real",
          value: { binding: 1 },
          prefixes: { variability: "parameter" },
          comment: "Gain of controller",
        },
        {
          $kind: "component",
          name: "Ti",
          type: {
            name: "Modelica.Units.SI.Time",
            restriction: "type",
            elements: [{ $kind: "extends", baseClass: "Real" }],
          },
          value: { binding: 0.5 },
          prefixes: { variability: "parameter" },
        },
        {
          $kind: "component",
          name: "y",
          type: "Real",
          prefixes: { variability: "" },
        },
      ],
    },
  } as unknown as ComponentElement;
}

describe("buildComponentParameterForm", () => {
  it("returns undefined when the component's type is a primitive name", () => {
    const leaf: ComponentElement = {
      $kind: "component",
      name: "controlError",
      type: "Real",
    } as unknown as ComponentElement;
    expect(buildComponentParameterForm(leaf)).toBeUndefined();
  });

  it("returns undefined when the type has no parameter elements", () => {
    const c: ComponentElement = {
      $kind: "component",
      name: "x",
      type: {
        name: "Empty",
        restriction: "block",
        elements: [],
      },
    } as unknown as ComponentElement;
    expect(buildComponentParameterForm(c)).toBeUndefined();
  });

  it("emits fields for each scalar/enum parameter using type-side defaults when no overrides are set", () => {
    const form = buildComponentParameterForm(pi())!;
    expect(form.componentName).toBe("PI");
    expect(form.model.fields.map((f) => f.name)).toEqual([
      "controllerType",
      "k",
      "Ti",
    ]);
    expect(form.values).toEqual({
      controllerType: "PID",
      k: 1,
      Ti: 0.5,
    });
    expect(form.refs.controllerType).toEqual({
      name: "controllerType",
      kind: "enum",
      enumTypeName: "Modelica.Blocks.Types.SimpleController",
      tab: "General",
      group: "Parameters",
    });
    const kRef = refOf(form, "k");
    expect(kRef.kind).toBe("number");
  });

  it("reads Dialog tab + group from sub-component parameter annotations", () => {
    const c: ComponentElement = {
      $kind: "component",
      name: "PI",
      type: {
        name: "T",
        restriction: "block",
        elements: [
          {
            $kind: "component",
            name: "init",
            type: "Real",
            value: { binding: 0 },
            prefixes: { variability: "parameter" },
            annotation: {
              Dialog: { tab: "Advanced", group: "Initialization" },
            },
          },
        ],
      },
    } as unknown as ComponentElement;
    const form = buildComponentParameterForm(c)!;
    expect(form.refs.init).toMatchObject({
      tab: "Advanced",
      group: "Initialization",
    });
  });

  it("prefers parent-class modifier overrides over type-side defaults", () => {
    const form = buildComponentParameterForm(
      pi({
        k: "100",
        controllerType: "Modelica.Blocks.Types.SimpleController.PI",
      }),
    )!;
    expect(form.values).toEqual({
      controllerType: "PI",
      k: 100,
      Ti: 0.5,
    });
  });

  it("unwraps $value-tagged modifier records and keeps the leaf value", () => {
    const form = buildComponentParameterForm(
      pi({ k: { $value: "42", final: true } }),
    )!;
    expect(form.values.k).toBe(42);
  });

  it("skips deeply-nested modifiers without surfacing them as parameters", () => {
    // Real-world example: `limiter: {u: {start: "0"}}` addresses a
    // grandchild of the sub-component; it isn't a parameter on PI
    // itself, so the form must NOT emit a "limiter" field.
    const form = buildComponentParameterForm(
      pi({ limiter: { u: { start: "0" } } }),
    )!;
    expect(form.model.fields.map((f) => f.name)).not.toContain("limiter");
  });

  it("surfaces parameters declared on inherited base classes (the `Torque.useSupport` case)", () => {
    // Models this shape:
    //   Torque extends PartialElementaryOneFlangeAndSupport2;
    //   PartialElementaryOneFlangeAndSupport2 has `parameter Boolean useSupport`
    // — `useSupport` isn't on Torque's own elements, only on the
    // ancestor. The form must walk the extends chain to pick it up.
    const torque: ComponentElement = {
      $kind: "component",
      name: "torque",
      type: {
        name: "Modelica.Mechanics.Rotational.Sources.Torque",
        restriction: "model",
        elements: [
          {
            $kind: "extends",
            baseClass: {
              name: "Modelica.Mechanics.Rotational.Interfaces.PartialElementaryOneFlangeAndSupport2",
              restriction: "partial model",
              elements: [
                {
                  $kind: "component",
                  name: "useSupport",
                  type: "Boolean",
                  value: { binding: false },
                  prefixes: { variability: "parameter" },
                  comment: "= true, if support flange enabled",
                },
              ],
            },
          },
          // Torque's own elements — `tau` is an input connector, not
          // a parameter; included so the test exercises BOTH the
          // ancestor walk and the own-elements skip.
          {
            $kind: "component",
            name: "tau",
            type: "Real",
            prefixes: { variability: "" },
          },
        ],
      },
    } as unknown as ComponentElement;

    const form = buildComponentParameterForm(torque)!;
    expect(form.model.fields.map((f) => f.name)).toContain("useSupport");
    expect(form.refs.useSupport).toEqual({
      name: "useSupport",
      kind: "boolean",
      tab: "General",
      group: "Parameters",
      // `useSupport` is declared on the ancestor base class, not on
      // Torque's own type — the ref records where it came from.
      inheritedFrom:
        "Modelica.Mechanics.Rotational.Interfaces.PartialElementaryOneFlangeAndSupport2",
    });
    expect(form.values.useSupport).toBe(false);
  });

  it("leaves inheritedFrom unset for a parameter declared on the component's own type", () => {
    // `pi()`'s parameters (controllerType, k, Ti) are all declared
    // directly on the component's type — none are inherited.
    const form = buildComponentParameterForm(pi())!;
    const kRef = refOf(form, "k");
    expect(kRef.inheritedFrom).toBeUndefined();
    expect("inheritedFrom" in kRef).toBe(false);
    const controllerTypeRef = refOf(form, "controllerType");
    expect(controllerTypeRef.inheritedFrom).toBeUndefined();
  });

  it("carries the declaration unit on the field schema (the `Inertia.J → kg.m2` case)", () => {
    // Models `Inertia` with `parameter Inertia J`, where `Inertia` is a
    // SI type aliased as `type Inertia = Real(unit="kg.m2")`. OMC serialises
    // the unit on the type alias's `extends Real(unit=…)`.
    const inertia: ComponentElement = {
      $kind: "component",
      name: "inertia",
      type: {
        name: "Modelica.Mechanics.Rotational.Components.Inertia",
        restriction: "model",
        elements: [
          {
            $kind: "component",
            name: "J",
            type: {
              name: "Modelica.Units.SI.Inertia",
              restriction: "type",
              elements: [
                {
                  $kind: "extends",
                  baseClass: "Real",
                  modifiers: { unit: '"kg.m2"' },
                },
              ],
            },
            value: { binding: 1 },
            prefixes: { variability: "parameter" },
            comment: "Moment of inertia",
          },
        ],
      },
    } as unknown as ComponentElement;

    const form = buildComponentParameterForm(inertia)!;
    const j = field(form.model, "J");
    expect(j.unit).toBe("kg.m2");
    // No use-site displayUnit modifier → undefined.
    expect(j.displayUnit).toBeUndefined();
  });

  it("carries the displayUnit modifier when the use site sets one (the `phi.start → deg` case)", () => {
    // `parameter Angle phi(displayUnit="deg")` where Angle = Real(unit="rad").
    const angleComp: ComponentElement = {
      $kind: "component",
      name: "spring",
      type: {
        name: "T",
        restriction: "model",
        elements: [
          {
            $kind: "component",
            name: "phi",
            modifiers: { displayUnit: '"deg"' },
            type: {
              name: "Modelica.Units.SI.Angle",
              restriction: "type",
              elements: [
                {
                  $kind: "extends",
                  baseClass: "Real",
                  modifiers: { unit: '"rad"' },
                },
              ],
            },
            value: { binding: 0 },
            prefixes: { variability: "parameter" },
          },
        ],
      },
    } as unknown as ComponentElement;

    const form = buildComponentParameterForm(angleComp)!;
    const phi = field(form.model, "phi");
    expect(phi.unit).toBe("rad");
    expect(phi.displayUnit).toBe("deg");
  });

  it("emits no unit metadata for a unit-less Real parameter (the `k` gain case)", () => {
    // `pi().k` is a bare `Real` with no unit alias — no unit metadata.
    const form = buildComponentParameterForm(pi())!;
    const k = field(form.model, "k");
    expect(k.unit).toBeUndefined();
    expect(k.displayUnit).toBeUndefined();
  });
});

describe("componentParameterValueToExpr", () => {
  it("delegates to the shared shape encoder", () => {
    expect(
      componentParameterValueToExpr(
        { name: "k", kind: "number", tab: "General", group: "Parameters" },
        7.5,
      ),
    ).toBe("7.5");
    expect(
      componentParameterValueToExpr(
        {
          name: "controllerType",
          kind: "enum",
          enumTypeName: "Modelica.Blocks.Types.SimpleController",
          tab: "General",
          group: "Parameters",
        },
        "PI",
      ),
    ).toBe("Modelica.Blocks.Types.SimpleController.PI");
  });
});

describe("componentParameterElementName", () => {
  it("joins component and parameter with a dot — OMC's `elementName` shape", () => {
    expect(componentParameterElementName("PI", "k")).toBe("PI.k");
  });
});

describe("componentParameterEditPlan (issue #76, item 1)", () => {
  const refs: Record<string, ComponentParameterRef> = {
    k: { name: "k", kind: "number", tab: "General", group: "Parameters" },
    Ti: { name: "Ti", kind: "number", tab: "General", group: "Parameters" },
  };

  it("emits only the changed fields", () => {
    const plan = componentParameterEditPlan(
      "PI",
      refs,
      { k: 1, Ti: 0.5 },
      { k: 2, Ti: 0.5 },
    );
    expect(plan).toEqual([{ elementName: "PI.k", expr: "2" }]);
  });

  it("clears EVERY surfaced parameter with a per-field empty expr on a blank-all submit", () => {
    // The critical case: 'blank all params'. Each surfaced parameter gets
    // its own `setElementModifierValue(..., "")` clear — and crucially this
    // is N field-clears, NOT a single bulk removeElementModifiers that would
    // also wipe start=/fixed=/nominal= and non-parameter modifiers.
    // A blanked numeric field arrives as `undefined` (coerceToKind maps a
    // non-finite/empty string to undefined); other kinds arrive as "".
    const plan = componentParameterEditPlan(
      "PI",
      refs,
      { k: 1, Ti: 0.5 },
      { k: undefined, Ti: "" },
    );
    expect(plan).toEqual([
      { elementName: "PI.k", expr: "" },
      { elementName: "PI.Ti", expr: "" },
    ]);
  });

  it("scopes the plan to surfaced refs only — never names a non-parameter modifier", () => {
    // `start`/`fixed`/`nominal`/`displayUnit` and non-parameter members are
    // not in `refs` (the form filters to variability=="parameter"), so the
    // plan can never touch them no matter what the caller passes in `submitted`.
    const plan = componentParameterEditPlan(
      "PI",
      refs,
      { k: 1, Ti: 0.5 },
      { k: "", Ti: "", start: "", fixed: false, "y.nominal": "" },
    );
    const names = plan.map((e) => e.elementName);
    expect(names).toEqual(["PI.k", "PI.Ti"]);
    expect(names).not.toContain("PI.start");
    expect(names).not.toContain("PI.fixed");
    expect(names).not.toContain("PI.y.nominal");
  });

  it("skips unsupported (record/array) refs entirely", () => {
    const withUnsupported: Record<string, ComponentParameterRef> = {
      ...refs,
      m: { name: "m", kind: "unsupported", tab: "General", group: "" },
    };
    const plan = componentParameterEditPlan(
      "PI",
      withUnsupported,
      { k: 1, Ti: 0.5, m: undefined },
      { k: "", Ti: "", m: "anything" },
    );
    expect(plan.map((e) => e.elementName)).toEqual(["PI.k", "PI.Ti"]);
  });

  it("treats two NaN numeric values as unchanged (blank stays blank)", () => {
    const plan = componentParameterEditPlan(
      "PI",
      { k: refs.k! },
      { k: NaN },
      { k: NaN },
    );
    expect(plan).toEqual([]);
  });
});
