/**
 * Hand-built mock data for the postprocessing stories — stands in for what the
 * extension host parses from a `.omresults` file and reads from `.mat` results.
 */

import type { ResultViewDoc, TracePayload } from "../../src/types.js";

export const sampleDoc: ResultViewDoc = {
  version: 1,
  results: [
    {
      id: "r1",
      label: "DCMotor run-1",
      path: "DCMotor_res.mat",
      model: "Lib.DCMotor",
      source: "simulate",
      createdAt: "2026-05-22T09:00:00.000Z",
      parameters: { "motor.R": "0.5" },
    },
    {
      id: "r2",
      label: "tank.mat",
      path: "/data/tank.mat",
      model: "Lib.Tank",
      source: "import",
      createdAt: "2026-05-22T09:05:00.000Z",
    },
  ],
  cards: [
    {
      kind: "plot",
      title: "Motor speed vs tank level",
      traces: [
        { result: "r1", variable: "motor.w" },
        { result: "r2", variable: "tank.level" },
      ],
    },
    { kind: "plot", title: "Empty plot" },
  ],
};

export const sampleVariablesByResult: Record<string, string[]> = {
  r1: ["time", "motor.w", "motor.i", "load.tau", "load.phi"],
  r2: ["time", "tank.level", "tank.flow"],
};

function series(fn: (t: number) => number, name: string): TracePayload {
  const t: number[] = [];
  const values: number[] = [];
  for (let i = 0; i <= 100; i++) {
    const x = i / 100;
    t.push(x);
    values.push(fn(x));
  }
  return { t, values, name };
}

export const sampleTraceData: Record<number, TracePayload[]> = {
  0: [
    series((x) => 1 - Math.exp(-5 * x), "DCMotor run-1 / motor.w"),
    series((x) => 0.5 + 0.4 * Math.sin(6 * x), "tank.mat / tank.level"),
  ],
};
