import { describe, expect, it } from "vitest";
import type { ComponentElement } from "@modelica-wrapper/omc-client";

import {
  buildComponentParameterForm,
  componentParameterElementName,
  componentParameterValueToExpr,
} from "./component-parameter-form.js";

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
    expect(Object.keys(form.schema.properties ?? {})).toEqual([
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
    expect(form.refs.k.kind).toBe("number");
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
            annotation: { Dialog: { tab: "Advanced", group: "Initialization" } },
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
    expect(Object.keys(form.schema.properties ?? {})).not.toContain("limiter");
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
    expect(Object.keys(form.schema.properties ?? {})).toContain("useSupport");
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
    expect(form.refs.k.inheritedFrom).toBeUndefined();
    expect("inheritedFrom" in form.refs.k).toBe(false);
    expect(form.refs.controllerType.inheritedFrom).toBeUndefined();
  });
});

describe("componentParameterValueToExpr", () => {
  it("delegates to the shared shape encoder", () => {
    expect(
      componentParameterValueToExpr({ name: "k", kind: "number" }, 7.5),
    ).toBe("7.5");
    expect(
      componentParameterValueToExpr(
        {
          name: "controllerType",
          kind: "enum",
          enumTypeName: "Modelica.Blocks.Types.SimpleController",
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
