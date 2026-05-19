import { describe, expect, it } from "vitest";

import {
  coerceInstantiatedValue,
  instantiatedParametersScope,
  parseInstantiatedParameters,
} from "./resolved-parameters.js";

describe("parseInstantiatedParameters", () => {
  it("splits each row on the first ` = ` and trims both sides", () => {
    const out = parseInstantiatedParameters([
      "k = 1.0",
      "Ti = 0.5",
      "controllerType = Modelica.Blocks.Types.SimpleController.PI",
    ]);
    expect(out).toEqual({
      k: "1.0",
      Ti: "0.5",
      controllerType: "Modelica.Blocks.Types.SimpleController.PI",
    });
  });

  it("preserves a value that itself contains ` = ` (record literal)", () => {
    const out = parseInstantiatedParameters(["m = record(a = 1, b = 2)"]);
    expect(out).toEqual({ m: "record(a = 1, b = 2)" });
  });

  it("skips malformed rows that lack the separator", () => {
    const out = parseInstantiatedParameters(["k = 1.0", "garbage", "Ti = 0.5"]);
    expect(out).toEqual({ k: "1.0", Ti: "0.5" });
  });
});

describe("coerceInstantiatedValue", () => {
  it("recognises booleans", () => {
    expect(coerceInstantiatedValue("true")).toBe(true);
    expect(coerceInstantiatedValue("false")).toBe(false);
  });

  it("recognises numeric literals (int, float, signed, exponent)", () => {
    expect(coerceInstantiatedValue("42")).toBe(42);
    expect(coerceInstantiatedValue("1.5")).toBe(1.5);
    expect(coerceInstantiatedValue("-1")).toBe(-1);
    expect(coerceInstantiatedValue("1e-6")).toBe(1e-6);
  });

  it("unwraps a quoted Modelica string literal", () => {
    expect(coerceInstantiatedValue('"hello"')).toBe("hello");
  });

  it("tags qualified enum literals", () => {
    expect(
      coerceInstantiatedValue("Modelica.Blocks.Types.Init.InitialState"),
    ).toEqual({
      $kind: "enum",
      name: "Modelica.Blocks.Types.Init.InitialState",
    });
  });

  it("leaves anything else (raw expression text) as the raw string", () => {
    expect(coerceInstantiatedValue("1 + 2")).toBe("1 + 2");
    expect(coerceInstantiatedValue("if a then 1 else 2")).toBe(
      "if a then 1 else 2",
    );
  });
});

describe("instantiatedParametersScope", () => {
  it("looks up top-level identifiers as coerced values", () => {
    const scope = instantiatedParametersScope({
      use_x: "true",
      k: "1.5",
      mode: "Modelica.Blocks.Types.Init.InitialState",
    });
    expect(scope.lookup(["use_x"])).toBe(true);
    expect(scope.lookup(["k"])).toBe(1.5);
    expect(scope.lookup(["mode"])).toEqual({
      $kind: "enum",
      name: "Modelica.Blocks.Types.Init.InitialState",
    });
  });

  it("returns undefined for unknown crefs (preserves the evaluator's fallback path)", () => {
    const scope = instantiatedParametersScope({ k: "1" });
    expect(scope.lookup(["nope"])).toBeUndefined();
  });

  it("ignores dotted keys (nested paths) at scope-build time", () => {
    // The scope is for the host class's top-level params only —
    // sub-component paths belong to a different scope.
    const scope = instantiatedParametersScope({
      "gain.k": "2.5",
      use_x: "true",
    });
    expect(scope.lookup(["gain", "k"])).toBeUndefined();
    expect(scope.lookup(["use_x"])).toBe(true);
  });

  it("accepts the raw OMC string-array form (auto-parses internally)", () => {
    const scope = instantiatedParametersScope(["k = 1.0", "use_x = true"]);
    expect(scope.lookup(["k"])).toBe(1);
    expect(scope.lookup(["use_x"])).toBe(true);
  });
});
