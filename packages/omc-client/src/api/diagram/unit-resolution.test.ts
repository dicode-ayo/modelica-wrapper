/**
 * Agreement tests for declaration-unit resolution.
 *
 * The diagram label and the parameter form read the same `ModelInstance` for
 * the same parameter, so a divergence between the two producers shows the user
 * two different units — or one unit and none — for one declaration. Every case
 * here asserts both producers, not one.
 */

import { describe, expect, it } from "vitest";

import {
  ModelInstanceSchema,
  type ModelInstance,
} from "../../_shared/modelInstance.js";
import { produceParameterModel } from "../parameters-form/producer.js";
import { produceDiagramLayout } from "./producer.js";

const HOST = "Test.UnitHost";

/** A host class declaring one `parameter J` of the given type. */
function hostWithParameter(type: unknown, modifiers?: unknown): ModelInstance {
  return ModelInstanceSchema.parse({
    name: HOST,
    restriction: "model",
    elements: [
      {
        $kind: "component",
        name: "J",
        type,
        modifiers,
        value: { binding: 1 },
        prefixes: { variability: "parameter" },
      },
    ],
  });
}

function diagramUnit(mi: ModelInstance): string | undefined {
  return produceDiagramLayout(mi, "icon").classes[HOST]?.parameters.J?.unit;
}

function formUnit(mi: ModelInstance): string | undefined {
  return produceParameterModel(mi).fields.find((f) => f.name === "J")?.unit;
}

function diagramDisplayUnit(mi: ModelInstance): string | undefined {
  return produceDiagramLayout(mi, "icon").classes[HOST]?.parameters.J
    ?.displayUnit;
}

function formDisplayUnit(mi: ModelInstance): string | undefined {
  return produceParameterModel(mi).fields.find((f) => f.name === "J")
    ?.displayUnit;
}

/** `type Marked = Real` — an alias contributing no unit of its own. */
const MARKER_ALIAS = {
  name: "Test.Units.Marked",
  restriction: "type",
  elements: [{ $kind: "extends", baseClass: "Real" }],
};

/** `Inertia extends MomentOfInertia extends Real(unit="kg.m2")`. */
const INERTIA_ALIAS = {
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
            modifiers: { unit: '"kg.m2"' },
          },
        ],
      },
    },
  ],
};

/**
 * `type L<n> = L<n-1>` nested `depth` times over an alias whose innermost
 * `extends Real` carries `unit="m"`.
 */
function nestedAliasChain(depth: number): unknown {
  let type: unknown = {
    name: "Test.Units.Deep",
    restriction: "type",
    elements: [
      { $kind: "extends", baseClass: "Real", modifiers: { unit: '"m"' } },
    ],
  };
  for (let i = 1; i <= depth; i++) {
    type = {
      name: `Test.Units.L${String(i)}`,
      restriction: "type",
      elements: [{ $kind: "extends", baseClass: type }],
    };
  }
  return type;
}

describe("declaration unit — diagram and parameter form agree", () => {
  it("resolves a unit reached only through the second extends clause", () => {
    const mi = hostWithParameter({
      name: "Test.Units.MarkedInertia",
      restriction: "type",
      elements: [
        { $kind: "extends", baseClass: MARKER_ALIAS },
        { $kind: "extends", baseClass: INERTIA_ALIAS },
      ],
    });

    expect(diagramUnit(mi)).toBe("kg.m2");
    expect(formUnit(mi)).toBe("kg.m2");
  });

  it("resolves a unit reached through the first extends clause", () => {
    const mi = hostWithParameter({
      name: "Test.Units.InertiaMarked",
      restriction: "type",
      elements: [
        { $kind: "extends", baseClass: INERTIA_ALIAS },
        { $kind: "extends", baseClass: MARKER_ALIAS },
      ],
    });

    expect(diagramUnit(mi)).toBe("kg.m2");
    expect(formUnit(mi)).toBe("kg.m2");
  });

  it("prefers a unit on the extends clause over one inside its base class", () => {
    const mi = hostWithParameter({
      name: "Test.Units.Regauged",
      restriction: "type",
      elements: [
        {
          $kind: "extends",
          baseClass: INERTIA_ALIAS,
          modifiers: { unit: '"g.mm2"' },
        },
      ],
    });

    expect(diagramUnit(mi)).toBe("g.mm2");
    expect(formUnit(mi)).toBe("g.mm2");
  });

  it("prefers the component's own modifier over the one on its type", () => {
    const mi = hostWithParameter(INERTIA_ALIAS, { unit: '"g.mm2"' });

    expect(diagramUnit(mi)).toBe("g.mm2");
    expect(formUnit(mi)).toBe("g.mm2");
  });

  it("reports no unit when no clause in the chain declares one", () => {
    const mi = hostWithParameter({
      name: "Test.Units.Bare",
      restriction: "type",
      elements: [{ $kind: "extends", baseClass: MARKER_ALIAS }],
    });

    expect(diagramUnit(mi)).toBeUndefined();
    expect(formUnit(mi)).toBeUndefined();
  });

  it("resolves a unit through a deeply nested alias chain", () => {
    const mi = hostWithParameter(nestedAliasChain(20));

    expect(diagramUnit(mi)).toBe("m");
    expect(formUnit(mi)).toBe("m");
  });

  it("reads displayUnit off the component's own modifier", () => {
    const mi = hostWithParameter(INERTIA_ALIAS, { displayUnit: '"deg"' });

    expect(diagramDisplayUnit(mi)).toBe("deg");
    expect(formDisplayUnit(mi)).toBe("deg");
  });
});
