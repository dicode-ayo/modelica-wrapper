/**
 * The run summary must report the window OMC ran, not the one submitted.
 *
 * A blank stop-time field is omitted from the call, which leaves the class's
 * `experiment` annotation to decide the window — so reading the bounds back
 * off the submitted input would report a run that never happened.
 */

import { describe, expect, it } from "vitest";

import { runWindow } from "./run-window.js";

const ANNOTATION_RUN =
  "startTime = 0.0, stopTime = 0.1, numberOfIntervals = 1000, tolerance = 1e-8, method = 'dassl'";

describe("runWindow", () => {
  it("reports OMC's resolved window over the omitted input", () => {
    expect(runWindow(ANNOTATION_RUN, {})).toEqual({ start: 0, stop: 0.1 });
  });

  it("prefers what ran to what was asked for when the two disagree", () => {
    expect(runWindow(ANNOTATION_RUN, { startTime: 0, stopTime: 5 })).toEqual({
      start: 0,
      stop: 0.1,
    });
  });

  it("falls back to the input when OMC echoes no options", () => {
    expect(runWindow("", { startTime: 0, stopTime: 5 })).toEqual({
      start: 0,
      stop: 5,
    });
  });

  it("treats a blank or unparseable bound as unread, not as a value", () => {
    expect(runWindow("startTime = , stopTime = 0.1", { startTime: 2 })).toEqual(
      {
        start: 2,
        stop: 0.1,
      },
    );
    expect(runWindow("startTime = none, stopTime = 0.1", {})).toBeUndefined();
  });

  it("is undefined when neither source knows a bound, so nothing is guessed", () => {
    expect(runWindow("", {})).toBeUndefined();
    expect(runWindow("", { startTime: 0 })).toBeUndefined();
  });
});
