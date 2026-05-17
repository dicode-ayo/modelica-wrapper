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
    });
    expect(form.refs.k.kind).toBe("number");
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
