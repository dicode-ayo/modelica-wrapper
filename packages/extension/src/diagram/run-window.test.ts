/**
 * The run summary must report the window OMC ran, not the one submitted.
 *
 * A blank stop-time field is omitted from the call, which leaves the class's
 * `experiment` annotation to decide the window — so reading the bounds back
 * off the submitted input would report a run that never happened.
 */

import { describe, expect, it } from "vitest";

import type { Value } from "@dicode/omc-client";

import { runWindow } from "./open-diagram.js";

/** A `SimulationResult` record carrying `simulationOptions`, as OMC returns it. */
function resultWith(simulationOptions: string): Value {
  return {
    kind: "call",
    name: "SimulationResult",
    args: [
      {
        kind: "kwarg",
        name: "simulationOptions",
        value: { kind: "string", value: simulationOptions },
      },
    ],
  } as Value;
}

const ANNOTATION_RUN =
  "startTime = 0.0, stopTime = 0.1, numberOfIntervals = 1000, tolerance = 1e-8, method = 'dassl'";

describe("runWindow", () => {
  it("reports OMC's resolved window over the omitted input", () => {
    expect(runWindow(resultWith(ANNOTATION_RUN), {})).toEqual({
      start: "0.0",
      stop: "0.1",
    });
  });

  it("prefers what ran to what was asked for when the two disagree", () => {
    expect(
      runWindow(resultWith(ANNOTATION_RUN), { startTime: 0, stopTime: 5 }),
    ).toEqual({ start: "0.0", stop: "0.1" });
  });

  it("falls back to the input when OMC reports no options", () => {
    expect(runWindow(resultWith(""), { startTime: 0, stopTime: 5 })).toEqual({
      start: 0,
      stop: 5,
    });
  });

  it("is undefined when neither source knows a bound, so nothing is guessed", () => {
    expect(runWindow(resultWith(""), {})).toBeUndefined();
    expect(runWindow(resultWith(""), { startTime: 0 })).toBeUndefined();
  });
});
