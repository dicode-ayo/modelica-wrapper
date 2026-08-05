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
function hostWithParameter(type: unknown): ModelInstance {
  return ModelInstanceSchema.parse({
    name: HOST,
    restriction: "model",
    elements: [
      {
        $kind: "component",
        name: "J",
        type,
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

  it("reports no unit when no clause in the chain declares one", () => {
    const mi = hostWithParameter({
      name: "Test.Units.Bare",
      restriction: "type",
      elements: [{ $kind: "extends", baseClass: MARKER_ALIAS }],
    });

    expect(diagramUnit(mi)).toBeUndefined();
    expect(formUnit(mi)).toBeUndefined();
  });
});
