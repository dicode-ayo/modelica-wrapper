/**
 * Pins that no schema default for the `experiment`-annotation values reaches
 * the `simulate(...)` command string; see `SimulateInputSchema`.
 */

import { describe, expect, it } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";
import {
  simulate,
  type SimulateInput,
  SimulateInputSchema,
} from "./simulate.js";

const RESULT =
  'record SimulationResult resultFile = "a_res.mat" end SimulationResult;';

/** Parsed first so schema defaults reach the command, as they do through the client. */
async function commandFor(input: SimulateInput): Promise<string | undefined> {
  const sent: string[] = [];
  const ctx: CallContext = {
    async call(cmd) {
      sent.push(cmd);
      return RESULT;
    },
    async getErrorString() {
      return { errorString: "" };
    },
  };
  await simulate(ctx, SimulateInputSchema.parse(input));
  return sent[0];
}

describe("simulate: the experiment-annotation values", () => {
  it("omits every annotation-backed argument the caller left out, and method's sentinel", async () => {
    expect(await commandFor({ typeName: "M" })).toBe(
      'simulate(M, outputFormat="mat", variableFilter=".*")',
    );
  });

  it("leaves them undefined at the schema, so no default can leak downstream", () => {
    const parsed = SimulateInputSchema.parse({ typeName: "M" });
    expect(parsed.stopTime).toBeUndefined();
    expect(parsed.numberOfIntervals).toBeUndefined();
    expect(parsed.tolerance).toBeUndefined();
    expect(parsed.startTime).toBeUndefined();
  });

  it("passes an explicit window through verbatim", async () => {
    const command = await commandFor({
      typeName: "M",
      startTime: 0,
      stopTime: 0.1,
      numberOfIntervals: 1000,
      tolerance: 1e-8,
    });
    expect(command).toBe(
      'simulate(M, startTime=0, stopTime=0.1, numberOfIntervals=1000, tolerance=1e-8, outputFormat="mat", variableFilter=".*")',
    );
  });
});
