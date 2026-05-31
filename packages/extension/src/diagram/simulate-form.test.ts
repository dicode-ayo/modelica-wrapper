import { describe, expect, it } from "vitest";

import {
  classNameToFilePrefix,
  simulateInputFromFormValues,
} from "./simulate-form.js";

describe("simulateInputFromFormValues", () => {
  it("maps the panel's flat values onto a simulate() input", () => {
    const input = simulateInputFromFormValues("My.Model", {
      startTime: 0,
      stopTime: 10,
      numberOfIntervals: 1000,
      tolerance: 1e-9,
      method: "dassl",
      outputFormat: "csv",
      variableFilter: "x.*",
    });
    expect(input).toEqual({
      typeName: "My.Model",
      startTime: 0,
      stopTime: 10,
      numberOfIntervals: 1000,
      tolerance: 1e-9,
      method: "dassl",
      outputFormat: "csv",
      variableFilter: "x.*",
      fileNamePrefix: "My_Model",
    });
  });

  it("passes the `<default>` method sentinel through unchanged (the producer's <default> choice)", () => {
    // produceSimulationModel can seed `method` to the `<default>` sentinel from
    // SOLVER_METHODS; the submit must forward it so OmcClient.simulate omits it
    // and OMC picks its own default solver.
    const input = simulateInputFromFormValues("M", { method: "<default>" });
    expect(input.method).toBe("<default>");
  });

  it("omits undefined / blank fields so the wrapper defaults apply", () => {
    const input = simulateInputFromFormValues("M", {
      startTime: undefined,
      method: "",
      variableFilter: undefined,
    });
    expect("startTime" in input).toBe(false);
    expect("method" in input).toBe(false);
    expect("variableFilter" in input).toBe(false);
    // fileNamePrefix is always derived.
    expect(input.fileNamePrefix).toBe("M");
  });

  it("drops non-finite numbers (a blank numeric field arrives as NaN)", () => {
    const input = simulateInputFromFormValues("M", { stopTime: NaN });
    expect("stopTime" in input).toBe(false);
  });

  it("always derives a shell-safe fileNamePrefix from the class name", () => {
    expect(
      classNameToFilePrefix("Modelica.Blocks.Examples.PID_Controller"),
    ).toBe("Modelica_Blocks_Examples_PID_Controller");
    expect(simulateInputFromFormValues("A.B.C", {}).fileNamePrefix).toBe(
      "A_B_C",
    );
  });
});
