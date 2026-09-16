/**
 * Wrapper-level tests for `simulate`'s `experiment`-annotation group.
 *
 * An omitted `startTime` / `stopTime` / `numberOfIntervals` / `tolerance` must
 * not reach the command string: OMC resolves an absent argument from the
 * class's `experiment` annotation, so a schema default here would override the
 * window the model asks for.
 */

import { describe, expect, it, vi } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";
import { simulate, SimulateInputSchema } from "./simulate.js";

const RESULT =
  'record SimulationResult resultFile = "a_res.mat" end SimulationResult;';

function fakeCtx(): {
  ctx: CallContext;
  sent: () => string;
} {
  const call = vi.fn(async () => RESULT);
  const ctx: CallContext = {
    call: call as unknown as CallContext["call"],
    getErrorString: async () => ({ errorString: "" }),
  };
  const sent = (): string => {
    const [command] = call.mock.calls[0] ?? [];
    if (typeof command !== "string") {
      throw new Error("simulate never called OMC");
    }
    return command;
  };
  return { ctx, sent };
}

/** The call OMC receives for `input`, through the same parse `invoke` runs. */
async function commandFor(
  input: Parameters<typeof SimulateInputSchema.parse>[0],
): Promise<string> {
  const { ctx, sent } = fakeCtx();
  await simulate(ctx, SimulateInputSchema.parse(input));
  return sent();
}

describe("simulate: the experiment-annotation group", () => {
  it("omits every annotation-backed argument the caller left out", async () => {
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
    expect(command).toContain(
      "simulate(M, startTime=0, stopTime=0.1, numberOfIntervals=1000, tolerance=1e-8",
    );
  });

  it("keeps method's sentinel out of the call so OMC picks the solver", async () => {
    expect(await commandFor({ typeName: "M" })).not.toContain("<default>");
  });
});
