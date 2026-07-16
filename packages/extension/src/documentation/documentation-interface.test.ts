/**
 * Tests for the documentation interface derivation — the pure map from a
 * `getModelInstance` tree to the read-only "Extends from" tree, parameter
 * table, and connector table. Synthetic `ModelInstance` literals are
 * round-tripped through `ModelInstanceSchema` so a shape divergence fails here
 * rather than silently in the producer.
 */

import { ModelInstanceSchema, type ModelInstance } from "@dicode/omc-client";
import { describe, expect, it } from "vitest";

import { buildDocumentationInterface } from "./documentation-interface.js";

function instance(
  elements: unknown[],
  extra: Record<string, unknown> = {},
): ModelInstance {
  return ModelInstanceSchema.parse({
    name: "Test.Class",
    restriction: "model",
    elements,
    ...extra,
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

function connectorType(name: string): unknown {
  return { name, restriction: "connector", elements: [] };
}

function connector(
  name: string,
  typeName: string,
  direction: "input" | "output",
  comment?: string,
): unknown {
  return {
    $kind: "component",
    name,
    type: connectorType(typeName),
    prefixes: { direction },
    ...(comment !== undefined ? { comment } : {}),
  };
}

describe("buildDocumentationInterface — parameters", () => {
  it("lists parameter components with value, unit, and description", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "k",
        type: siType("Modelica.Units.SI.Angle", "rad"),
        value: { binding: 1.5 },
        prefixes: { variability: "parameter" },
        comment: "Gain of controller",
      },
    ]);
    const { parameters } = buildDocumentationInterface(mi);
    expect(parameters).toHaveLength(1);
    expect(parameters[0]).toMatchObject({
      name: "k",
      description: "Gain of controller",
      value: "1.5",
      unit: "rad",
      group: "Parameters",
    });
  });

  it("skips non-parameter components", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "x",
        type: "Real",
        prefixes: { variability: "" },
      },
    ]);
    expect(buildDocumentationInterface(mi).parameters).toEqual([]);
  });

  it("renders an empty value string when no binding is present", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "n",
        type: "Integer",
        prefixes: { variability: "parameter" },
      },
    ]);
    expect(buildDocumentationInterface(mi).parameters[0]?.value).toBe("");
  });

  it("renders a symbolic default from the raw binding (cref, arithmetic)", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "T",
        type: "Real",
        value: {
          binding: {
            $kind: "binary_op",
            op: "*",
            lhs: 2,
            rhs: { $kind: "cref", parts: [{ name: "pi" }] },
          },
        },
        prefixes: { variability: "parameter" },
      },
      {
        $kind: "component",
        name: "kd",
        type: "Real",
        value: { binding: { $kind: "cref", parts: [{ name: "k" }] } },
        prefixes: { variability: "parameter" },
      },
    ]);
    const { parameters } = buildDocumentationInterface(mi);
    expect(parameters[0]?.value).toBe("2 * pi");
    expect(parameters[1]?.value).toBe("k");
  });

  it("renders a DynamicSelect default by its static branch", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "level",
        type: "Real",
        value: {
          binding: {
            $kind: "call",
            name: "DynamicSelect",
            arguments: [0.5, { $kind: "cref", parts: [{ name: "level" }] }],
          },
        },
        prefixes: { variability: "parameter" },
      },
    ]);
    expect(buildDocumentationInterface(mi).parameters[0]?.value).toBe("0.5");
  });
});

describe("buildDocumentationInterface — connectors", () => {
  it("lists connector components with leaf type name, direction, and comment", () => {
    const mi = instance([
      connector(
        "u",
        "Modelica.Blocks.Interfaces.RealInput",
        "input",
        "Setpoint",
      ),
      connector("y", "Modelica.Blocks.Interfaces.RealOutput", "output"),
    ]);
    expect(buildDocumentationInterface(mi).connectors).toEqual([
      {
        name: "u",
        description: "Setpoint",
        typeName: "RealInput",
        direction: "input",
      },
      { name: "y", typeName: "RealOutput", direction: "output" },
    ]);
  });

  it("does not treat a plain (non-connector) component as a connector", () => {
    const mi = instance([
      {
        $kind: "component",
        name: "gain",
        type: { name: "Modelica.Blocks.Math.Gain", restriction: "block" },
      },
    ]);
    expect(buildDocumentationInterface(mi).connectors).toEqual([]);
  });

  it("includes a connector inherited through extends", () => {
    const base = {
      name: "Modelica.Blocks.Interfaces.SISO",
      restriction: "block",
      elements: [
        connector("u", "Modelica.Blocks.Interfaces.RealInput", "input"),
      ],
    };
    const mi = instance([
      { $kind: "extends", baseClass: base },
      connector("y", "Modelica.Blocks.Interfaces.RealOutput", "output"),
    ]);
    expect(
      buildDocumentationInterface(mi).connectors.map((c) => c.name),
    ).toEqual(["y", "u"]);
  });

  it("lets a more-derived redeclaration shadow an inherited connector of the same name", () => {
    const base = {
      name: "Base",
      restriction: "block",
      elements: [
        connector("u", "Modelica.Blocks.Interfaces.RealInput", "input"),
      ],
    };
    // The host redeclares `u` as a plain (non-connector) component; the base
    // connector must not resurface.
    const mi = instance([
      { $kind: "extends", baseClass: base },
      {
        $kind: "component",
        name: "u",
        type: { name: "Modelica.Blocks.Math.Gain", restriction: "block" },
      },
    ]);
    expect(buildDocumentationInterface(mi).connectors).toEqual([]);
  });
});

describe("buildDocumentationInterface — extends tree", () => {
  it("walks the inheritance chain with base-class names and comments", () => {
    const grandBase = {
      name: "Modelica.Blocks.Interfaces.BlockIcon",
      restriction: "block",
      comment: "Basic graphical layout",
    };
    const base = {
      name: "Modelica.Blocks.Interfaces.SISO",
      restriction: "block",
      comment: "Single Input Single Output",
      elements: [{ $kind: "extends", baseClass: grandBase }],
    };
    const mi = instance([{ $kind: "extends", baseClass: base }]);
    const { extendsTree } = buildDocumentationInterface(mi);
    expect(extendsTree).toEqual([
      {
        name: "Modelica.Blocks.Interfaces.SISO",
        comment: "Single Input Single Output",
        children: [
          {
            name: "Modelica.Blocks.Interfaces.BlockIcon",
            comment: "Basic graphical layout",
            children: [],
          },
        ],
      },
    ]);
  });

  it("skips primitive (string) bases", () => {
    const mi = instance([{ $kind: "extends", baseClass: "Real" }], {
      restriction: "type",
    });
    expect(buildDocumentationInterface(mi).extendsTree).toEqual([]);
  });
});
