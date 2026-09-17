import { describe, expect, it } from "vitest";

import { looksLikeError, withErrorBuffer } from "./error-buffer.js";

describe("looksLikeError", () => {
  it("treats the literal word Error as a hard failure", () => {
    expect(
      looksLikeError("Error: An element with name R is already declared"),
    ).toBe(true);
  });

  it("does not treat a warning or notice as a failure", () => {
    expect(looksLikeError("Warning: der(x) is not defined; assuming 0")).toBe(
      false,
    );
    expect(looksLikeError("")).toBe(false);
  });
});

describe("withErrorBuffer", () => {
  it("clears the buffer before run and reports what run left behind", async () => {
    const calls: string[] = [];
    let buffer = "stale from an earlier, unrelated call";
    const client = {
      getErrorString: async () => {
        calls.push("getErrorString");
        const errorString = buffer;
        buffer = "";
        return { errorString };
      },
    };

    const { result, errorString } = await withErrorBuffer(client, async () => {
      calls.push("run");
      buffer = "Error: this call's own diagnostic";
      return "ok";
    });

    expect(result).toBe("ok");
    expect(errorString).toBe("Error: this call's own diagnostic");
    // Cleared before `run`, read again after — the stale text never reaches
    // the caller as if it were this call's own.
    expect(calls).toEqual(["getErrorString", "run", "getErrorString"]);
  });

  it("reports an empty string when the call leaves nothing behind", async () => {
    const client = { getErrorString: async () => ({ errorString: "" }) };
    const { errorString } = await withErrorBuffer(client, async () => "ok");
    expect(errorString).toBe("");
  });

  it("does not let a slow call in flight lose its own diagnostic to a faster call's clear", async () => {
    // Simulates two callers sharing one OmcClient (e.g. an MCP tool call and
    // a diagram edit): the slow call leaves its diagnostic and is still
    // mid-flight when the fast call starts. Without serializing the whole
    // clear-run-read sequence per client, the fast call's own clear would
    // wipe the slow call's diagnostic before it's ever read back.
    let buffer = "";
    let releaseSlow: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    let signalReachedGate: () => void = () => undefined;
    const reachedGate = new Promise<void>((resolve) => {
      signalReachedGate = resolve;
    });
    const client = {
      getErrorString: async () => {
        const errorString = buffer;
        buffer = "";
        return { errorString };
      },
    };

    const slowPromise = withErrorBuffer(client, async () => {
      buffer = "Error: from the slow call";
      signalReachedGate();
      await gate;
      return "slow";
    });
    await reachedGate;
    const fastPromise = withErrorBuffer(client, async () => "fast");
    releaseSlow();

    const [slow, fast] = await Promise.all([slowPromise, fastPromise]);
    expect(slow.errorString).toBe("Error: from the slow call");
    expect(fast.errorString).toBe("");
  });

  it("keeps separate queues for separate client instances", async () => {
    const clientA = { getErrorString: async () => ({ errorString: "" }) };
    const clientB = { getErrorString: async () => ({ errorString: "" }) };
    const order: string[] = [];

    await Promise.all([
      withErrorBuffer(clientA, async () => {
        order.push("a-start");
        await Promise.resolve();
        order.push("a-end");
      }),
      withErrorBuffer(clientB, async () => {
        order.push("b-start");
        order.push("b-end");
      }),
    ]);

    // b, on its own queue, isn't forced to wait for a's turn to finish.
    expect(order.indexOf("b-start")).toBeLessThan(order.indexOf("a-end"));
  });

  it("chains past a rejected turn instead of leaving the next caller stuck", async () => {
    const client = { getErrorString: async () => ({ errorString: "" }) };

    await expect(
      withErrorBuffer(client, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const { result } = await withErrorBuffer(client, async () => "recovered");
    expect(result).toBe("recovered");
  });
});
