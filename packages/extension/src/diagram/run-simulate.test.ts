/**
 * `runSimulate` treats OMC's error buffer as authoritative over a populated
 * `resultFile` — a genuine Error left in the buffer must reject the run even
 * when `simulate()` still reports a (stale or partial) result file, the same
 * silent-success shape `withErrorBuffer` closes elsewhere (issue #657).
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { OmcClient, Value } from "@dicode/omc-client";

import { recordedMessages } from "../../test-support/vscode-mock.js";

import { runSimulate } from "./open-diagram.js";

afterEach(() => {
  recordedMessages.length = 0;
});

function kwarg(name: string, value: string): Value {
  return { kind: "kwarg", name, value: { kind: "string", value } } as Value;
}

function simulationResult(fields: Record<string, string>): Value {
  return {
    kind: "call",
    name: "SimulationResult",
    args: Object.entries(fields).map(([name, value]) => kwarg(name, value)),
  } as Value;
}

function makeClient(opts: {
  resultFile?: string;
  errorString?: string;
}): OmcClient {
  return {
    simulate: async () => ({
      simulationResult: simulationResult({
        resultFile: opts.resultFile ?? "res.mat",
        messages: "",
      }),
    }),
    getErrorString: async () => ({ errorString: opts.errorString ?? "" }),
    lastCall: "simulate(Demo)",
  } as unknown as OmcClient;
}

describe("runSimulate", () => {
  it("reports success and adds the result to view when the buffer is clean", async () => {
    const client = makeClient({});

    await runSimulate(client, "Demo", {});

    expect(recordedMessages).toEqual([]);
  });

  it("rejects a resultFile OMC reports alongside an Error in its buffer", async () => {
    const client = makeClient({
      errorString: "Error: division by zero at time 0.5",
    });

    await runSimulate(client, "Demo", {});

    expect(recordedMessages).toHaveLength(1);
    expect(recordedMessages[0]?.level).toBe("error");
    expect(recordedMessages[0]?.message).toContain("simulate Demo failed");
  });

  it("still surfaces a plain warning as success, not a failure", async () => {
    const client = makeClient({
      errorString: "Warning: der(x) is not defined; assuming 0",
    });

    await runSimulate(client, "Demo", {});

    expect(recordedMessages).toEqual([]);
  });
});
