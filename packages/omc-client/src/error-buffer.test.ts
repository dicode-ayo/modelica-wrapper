import { describe, expect, it } from "vitest";

import { looksLikeError, runQueued, withErrorBuffer } from "./error-buffer.js";

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

  it("drains a diagnostic a rejected run left behind, instead of leaking it to the next turn", async () => {
    // OMC can execute the mutation and leave a diagnostic before the call
    // itself rejects (a transport error after the RPC's own effect landed).
    // Without draining on the rejection path too, that diagnostic survives
    // into whatever runs next on this queue.
    let buffer = "";
    const client = {
      getErrorString: async () => {
        const errorString = buffer;
        buffer = "";
        return { errorString };
      },
    };

    await expect(
      withErrorBuffer(client, async () => {
        buffer = "Error: left behind by a call that then rejected";
        throw new Error("transport reset");
      }),
    ).rejects.toThrow("transport reset");

    const read = await runQueued(client, () => client.getErrorString());
    expect(read).toEqual({ errorString: "" });
  });

  it("still throws the original rejection when the cleanup drain itself fails", async () => {
    let calls = 0;
    const client = {
      getErrorString: async () => {
        calls += 1;
        // The pre-call clear (call 1) must succeed so `run` actually gets to
        // reject; only the post-rejection cleanup drain (call 2) fails here.
        if (calls === 1) return { errorString: "" };
        throw new Error("socket closed");
      },
    };

    await expect(
      withErrorBuffer(client, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});

describe("runQueued", () => {
  it("runs without an extra clear or drain of its own", async () => {
    const calls: string[] = [];
    const client = {
      getErrorString: async () => {
        calls.push("getErrorString");
        return { errorString: "" };
      },
    };

    const result = await runQueued(client, async () => {
      calls.push("run");
      return "ok";
    });

    expect(result).toBe("ok");
    expect(calls).toEqual(["run"]);
  });

  it("queues behind an in-flight withErrorBuffer turn instead of racing its drain", async () => {
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

    const mutation = withErrorBuffer(client, async () => {
      buffer = "Error: from the mutation";
      signalReachedGate();
      await gate;
      return "done";
    });
    await reachedGate;
    const read = runQueued(client, () => client.getErrorString());
    releaseSlow();

    const [{ errorString }, readResult] = await Promise.all([mutation, read]);
    expect(errorString).toBe("Error: from the mutation");
    // Queued behind the mutation's own drain, so the read only reaches the
    // buffer after that drain already consumed the diagnostic.
    expect(readResult).toEqual({ errorString: "" });
  });
});
