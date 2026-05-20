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

  it("layers host-resolved values BETWEEN class defaults and instance modifiers", () => {
    // Class defaults provide the floor, host-resolved values overlay
    // (for crefs the host bound externally), instance modifiers win.
    const subs = buildSubstitutions(
      makeInstance({ modifiers: { d: "instModOverride" } }),
      makeClass({
        c: { name: "c", value: "classDefault" },
        d: { name: "d", value: "classDefault" },
        k: { name: "k", value: "classDefault" },
      }),
      {
        // Only entries prefixed with `<instance.name>.` apply — others
        // are scoped to OTHER instances on the host.
        "sd1.c": "hostResolved",
        "sd1.d": "hostResolvedD",
        "otherInstance.k": "shouldNotLeak",
      },
    );
    expect(subs.parameters?.c).toBe("hostResolved"); // host overlay applied
    expect(subs.parameters?.d).toBe("instModOverride"); // instance modifier wins
    expect(subs.parameters?.k).toBe("classDefault"); // host map had no row → unchanged
  });

  it("only reads keys belonging to this instance (prefix filter)", () => {
    const subs = buildSubstitutions(
      makeInstance({ name: "gainA" }),
      makeClass({ k: { name: "k", value: "1" } }),
      {
        "gainA.k": "fromHost",
        "gainB.k": "differentInstance",
      },
    );
    expect(subs.parameters?.k).toBe("fromHost");
  });

  it("appends a single array dimension to %name", () => {
    const subs = buildSubstitutions(
      makeInstance({ name: "pins", dims: ["3"] }),
      makeClass(),
    );
    expect(subs.name).toBe("pins[3]");
  });

  it("appends multiple array dimensions joined with ', '", () => {
    const subs = buildSubstitutions(
      makeInstance({ name: "grid", dims: ["2", "4"] }),
      makeClass(),
    );
    expect(subs.name).toBe("grid[2, 4]");
  });

  it("leaves %name unchanged for a scalar component (no dims)", () => {
    const subs = buildSubstitutions(
      makeInstance({ name: "sd1" }),
      makeClass(),
    );
    expect(subs.name).toBe("sd1");
  });

  it("leaves %name unchanged for an empty dims array", () => {
    const subs = buildSubstitutions(
      makeInstance({ name: "sd1", dims: [] }),
      makeClass(),
    );
    expect(subs.name).toBe("sd1");
  });

  describe("unit annotation", () => {
    it("appends the declared unit to a literal class default", () => {
      const subs = buildSubstitutions(
        makeInstance(),
        makeClass({ J: { name: "J", value: "1", unit: "kg.m2" } }),
      );
      expect(subs.parameters?.J).toBe("1 kg.m2");
    });

    it("appends the unit to an INSTANCE-MODIFIER value (the drive-train case)", () => {
      // `spring(c=1e4, d=100)` supplies c/d as instance modifiers; the unit
      // lives on the class param. The host-side annotation never reaches
      // modifiers, so this is the path that was dropping units in labels.
      const subs = buildSubstitutions(
        makeInstance({ modifiers: { c: "1e4", d: "100" } }),
        makeClass({
          c: { name: "c", value: "", unit: "N.m/rad" },
          d: { name: "d", value: "", unit: "N.m.s/rad" },
        }),
      );
      expect(subs.parameters?.c).toBe("1e4 N.m/rad"); // literal preserved
      expect(subs.parameters?.d).toBe("100 N.m.s/rad");
    });

    it("does not annotate non-literal values (expressions / blanks)", () => {
      const subs = buildSubstitutions(
        makeInstance({ modifiers: { c: "k*2" } }),
        makeClass({ c: { name: "c", value: "k*2", unit: "N.m/rad" } }),
      );
      expect(subs.parameters?.c).toBe("k*2");
    });

    it("skips the dimensionless placeholder unit==\"1\"", () => {
      const subs = buildSubstitutions(
        makeInstance(),
        makeClass({ ratio: { name: "ratio", value: "2", unit: "1" } }),
      );
      expect(subs.parameters?.ratio).toBe("2");
    });

    it("leaves a value alone when no unit is declared", () => {
      const subs = buildSubstitutions(
        makeInstance(),
        makeClass({ n: { name: "n", value: "3" } }),
      );
      expect(subs.parameters?.n).toBe("3");
    });

    it("does not double-annotate a host-converted displayUnit default", () => {
      // The host pre-rewrites a converted class default to a non-numeric
      // string like "90 deg"; the numeric guard here leaves it untouched.
      const subs = buildSubstitutions(
        makeInstance(),
        makeClass({
          phi: { name: "phi", value: "90 deg", unit: "rad", displayUnit: "deg" },
        }),
      );
      expect(subs.parameters?.phi).toBe("90 deg");
    });
  });
});
