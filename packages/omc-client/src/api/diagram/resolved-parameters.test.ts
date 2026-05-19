import { describe, expect, it } from "vitest";

import { parseInstantiatedParameters } from "./resolved-parameters.js";

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

  it("ignores rows whose name is empty after the trim", () => {
    expect(parseInstantiatedParameters([" = solo"])).toEqual({});
  });
});
