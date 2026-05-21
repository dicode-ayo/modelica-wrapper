/**
 * Tests for the simulate-model producer and the SOLVER_METHODS constant.
 *
 * All pure — no OMC contact. `produceSimulationModel` is a pure function of
 * `{ className, options }` (a `GetSimulationOptionsOutput`), so we hand it
 * literal option records and assert the emitted `ParameterModel`.
 *
 * Coverage:
 *  - SOLVER_METHODS is OMC's documented `-s/--solver` set + `<default>`, and
 *    does NOT include the stale `trapezoid` the old curated schema carried.
 *  - field set / kinds / units / groups / seeded values
 *  - method enum choices === SOLVER_METHODS; outputFormat enum === OUTPUT_FORMATS
 *  - field names match the submit mapping (`simulateInputFromFormValues` keys)
 */

import { describe, expect, it } from "vitest";

import type { GetSimulationOptionsOutput } from "../execution/getSimulationOptions.js";
import {
  DEFAULT_OUTPUT_FORMAT,
  DEFAULT_SOLVER_METHOD,
  OUTPUT_FORMATS,
  SOLVER_METHODS,
  produceSimulationModel,
  type ParameterField,
  type ParameterModel,
} from "./index.js";

const OPTIONS: GetSimulationOptionsOutput = {
  startTime: 0,
  stopTime: 1,
  tolerance: 1e-6,
  numberOfIntervals: 500,
  interval: 0.002,
};

function fieldByName(model: ParameterModel, name: string): ParameterField {
  const f = model.fields.find((x) => x.name === name);
  if (!f) throw new Error(`no field ${name}`);
  return f;
}

describe("SOLVER_METHODS", () => {
  it("is OMC's documented -s/--solver value set plus <default>", () => {
    expect(SOLVER_METHODS).toEqual([
      "dassl",
      "ida",
      "cvode",
      "gbode",
      "euler",
      "rungekutta",
      "symSolver",
      "symSolverSsc",
      "qss",
      "optimization",
      "<default>",
    ]);
  });

  it("does not carry the stale `trapezoid` method", () => {
    expect(SOLVER_METHODS).not.toContain("trapezoid");
  });

  it("includes the methods the old curated schema omitted", () => {
    expect(SOLVER_METHODS).toContain("gbode");
    expect(SOLVER_METHODS).toContain("symSolver");
    expect(SOLVER_METHODS).toContain("symSolverSsc");
  });

  it("defaults to dassl", () => {
    expect(DEFAULT_SOLVER_METHOD).toBe("dassl");
    expect(SOLVER_METHODS).toContain(DEFAULT_SOLVER_METHOD);
  });

  it("OUTPUT_FORMATS is the small fixed OMC set", () => {
    expect(OUTPUT_FORMATS).toEqual(["mat", "csv", "plt", "empty"]);
    expect(DEFAULT_OUTPUT_FORMAT).toBe("mat");
  });
});

describe("produceSimulationModel", () => {
  it("sets className and leaves component unset", () => {
    const model = produceSimulationModel({ className: "My.Model", options: OPTIONS });
    expect(model.className).toBe("My.Model");
    expect(model.component).toBeUndefined();
  });

  it("emits the expected field set in order", () => {
    const model = produceSimulationModel({ className: "M", options: OPTIONS });
    expect(model.fields.map((f) => f.name)).toEqual([
      "startTime",
      "stopTime",
      "interval",
      "numberOfIntervals",
      "tolerance",
      "method",
      "outputFormat",
      "variableFilter",
    ]);
  });

  it("seeds time/tolerance/intervals from the experiment options", () => {
    const model = produceSimulationModel({ className: "M", options: OPTIONS });
    expect(fieldByName(model, "startTime").value).toBe(0);
    expect(fieldByName(model, "stopTime").value).toBe(1);
    expect(fieldByName(model, "interval").value).toBe(0.002);
    expect(fieldByName(model, "tolerance").value).toBe(1e-6);
    expect(fieldByName(model, "numberOfIntervals").value).toBe(500);
  });

  it("seeds non-experiment fields from schema defaults", () => {
    const model = produceSimulationModel({ className: "M", options: OPTIONS });
    expect(fieldByName(model, "method").value).toBe(DEFAULT_SOLVER_METHOD);
    expect(fieldByName(model, "outputFormat").value).toBe(DEFAULT_OUTPUT_FORMAT);
    expect(fieldByName(model, "variableFilter").value).toBe(".*");
  });

  it("reflects custom experiment values", () => {
    const model = produceSimulationModel({
      className: "M",
      options: {
        startTime: 2,
        stopTime: 10,
        tolerance: 1e-9,
        numberOfIntervals: 1000,
        interval: 0.008,
      },
    });
    expect(fieldByName(model, "startTime").value).toBe(2);
    expect(fieldByName(model, "stopTime").value).toBe(10);
    expect(fieldByName(model, "tolerance").value).toBe(1e-9);
    expect(fieldByName(model, "numberOfIntervals").value).toBe(1000);
    expect(fieldByName(model, "interval").value).toBe(0.008);
  });

  it("classifies field kinds correctly", () => {
    const model = produceSimulationModel({ className: "M", options: OPTIONS });
    expect(fieldByName(model, "startTime").kind).toBe("number");
    expect(fieldByName(model, "stopTime").kind).toBe("number");
    expect(fieldByName(model, "interval").kind).toBe("number");
    expect(fieldByName(model, "tolerance").kind).toBe("number");
    expect(fieldByName(model, "numberOfIntervals").kind).toBe("integer");
    expect(fieldByName(model, "method").kind).toBe("enum");
    expect(fieldByName(model, "outputFormat").kind).toBe("enum");
    expect(fieldByName(model, "variableFilter").kind).toBe("string");
  });

  it("tags time fields with the second unit and others unitless", () => {
    const model = produceSimulationModel({ className: "M", options: OPTIONS });
    expect(fieldByName(model, "startTime").unit).toBe("s");
    expect(fieldByName(model, "stopTime").unit).toBe("s");
    expect(fieldByName(model, "interval").unit).toBe("s");
    expect(fieldByName(model, "tolerance").unit).toBeUndefined();
    expect(fieldByName(model, "numberOfIntervals").unit).toBeUndefined();
    expect(fieldByName(model, "variableFilter").unit).toBeUndefined();
  });

  it("sources method choices from SOLVER_METHODS", () => {
    const model = produceSimulationModel({ className: "M", options: OPTIONS });
    expect(fieldByName(model, "method").enumChoices).toEqual([...SOLVER_METHODS]);
  });

  it("sources outputFormat choices from OUTPUT_FORMATS", () => {
    const model = produceSimulationModel({ className: "M", options: OPTIONS });
    expect(fieldByName(model, "outputFormat").enumChoices).toEqual([
      ...OUTPUT_FORMATS,
    ]);
  });

  it("buckets fields into General / Solver / Output groups", () => {
    const model = produceSimulationModel({ className: "M", options: OPTIONS });
    const group = (name: string): string => fieldByName(model, name).dialog.group;
    expect(group("startTime")).toBe("General");
    expect(group("stopTime")).toBe("General");
    expect(group("interval")).toBe("General");
    expect(group("numberOfIntervals")).toBe("Solver");
    expect(group("tolerance")).toBe("Solver");
    expect(group("method")).toBe("Solver");
    expect(group("outputFormat")).toBe("Output");
    expect(group("variableFilter")).toBe("Output");
  });

  it("all fields share the General tab", () => {
    const model = produceSimulationModel({ className: "M", options: OPTIONS });
    for (const f of model.fields) expect(f.dialog.tab).toBe("General");
  });

  it("carries defaultValue on every field for reset/dirty detection", () => {
    const model = produceSimulationModel({ className: "M", options: OPTIONS });
    expect(fieldByName(model, "startTime").defaultValue).toBe(0);
    expect(fieldByName(model, "stopTime").defaultValue).toBe(1);
    expect(fieldByName(model, "tolerance").defaultValue).toBe(1e-6);
    expect(fieldByName(model, "numberOfIntervals").defaultValue).toBe(500);
    expect(fieldByName(model, "method").defaultValue).toBe(DEFAULT_SOLVER_METHOD);
  });

  it("uses field names that match the submit mapping keys", () => {
    // simulateInputFromFormValues reads exactly these keys.
    const expected = [
      "startTime",
      "stopTime",
      "numberOfIntervals",
      "tolerance",
      "method",
      "outputFormat",
      "variableFilter",
    ];
    const model = produceSimulationModel({ className: "M", options: OPTIONS });
    const names = new Set(model.fields.map((f) => f.name));
    for (const k of expected) expect(names.has(k)).toBe(true);
  });
});
