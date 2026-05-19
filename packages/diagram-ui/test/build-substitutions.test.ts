import { describe, expect, it } from "vitest";
import type {
  ClassDef,
  ComponentInstance,
} from "@modelica-wrapper/omc-client";

import { buildSubstitutions } from "../src/label/build-substitutions.js";

function makeInstance(
  partial: Partial<ComponentInstance> = {},
): ComponentInstance {
  return {
    name: "sd1",
    classRef: "Modelica.Mechanics.Rotational.Components.SpringDamper",
    placement: { extent: [[-10, -10], [10, 10]] },
    ...partial,
  };
}

function makeClass(
  parameters: ClassDef["parameters"] = {},
): ClassDef {
  return {
    name: "Modelica.Mechanics.Rotational.Components.SpringDamper",
    restriction: "model",
    iconLayers: [],
    connectors: {},
    parameters,
  };
}

describe("buildSubstitutions", () => {
  it("populates %name and %class from the instance", () => {
    const subs = buildSubstitutions(makeInstance(), makeClass());
    expect(subs.name).toBe("sd1");
    expect(subs.class).toBe(
      "Modelica.Mechanics.Rotational.Components.SpringDamper",
    );
  });

  it("seeds parameters from class defaults", () => {
    const subs = buildSubstitutions(
      makeInstance(),
      makeClass({
        c: { name: "c", value: "100" },
        d: { name: "d", value: "0.5" },
      }),
    );
    expect(subs.parameters?.c).toBe("100");
    expect(subs.parameters?.d).toBe("0.5");
  });

  it("overlays per-instance modifiers on top of class defaults", () => {
    const subs = buildSubstitutions(
      makeInstance({ modifiers: { d: "2.5" } }),
      makeClass({
        c: { name: "c", value: "100" },
        d: { name: "d", value: "0.5" },
      }),
    );
    expect(subs.parameters?.c).toBe("100"); // unchanged
    expect(subs.parameters?.d).toBe("2.5"); // overridden
  });

  it("walks $value when the override is a nested modifier object", () => {
    // OMC emits structured modifiers like `{min: "0", $value: "42"}`
    // when the override also constrains the parameter; we want the
    // display value, not the wrapper object.
    const subs = buildSubstitutions(
      makeInstance({ modifiers: { c: { min: "0", $value: "42" } } }),
      makeClass({ c: { name: "c", value: "100" } }),
    );
    expect(subs.parameters?.c).toBe("42");
  });

  it("tolerates an absent class def", () => {
    const subs = buildSubstitutions(
      makeInstance({ modifiers: { d: "0.5" } }),
      undefined,
    );
    expect(subs.parameters?.d).toBe("0.5");
  });
});
