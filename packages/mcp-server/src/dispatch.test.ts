/**
 * `dispatchByName`'s error-buffer drain, exercised directly against fine
 * -grained control over when a mocked `invoke` resolves — the concurrency
 * invariant this pins needs that control, which the full MCP transport
 * `mcp-server.test.ts` drives doesn't give a test.
 */

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { OmcDiagnosticError, REGISTRY } from "@dicode/omc-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  dispatchByName,
  type McpToolClient,
  type McpToolDeps,
} from "./dispatch.js";
import type { WriteVerdictSource } from "./write-verdict.js";

/** Every field `dispatchByName` and the write gate could touch, all inert. */
function baseClient(overrides: Partial<McpToolClient> = {}): McpToolClient {
  return {
    invoke: async () => ({ ok: true }),
    cd: async ({ newWorkingDirectory }) => ({
      workingDirectory: newWorkingDirectory,
    }),
    deleteClass: async () => ({ success: true }),
    existClass: async () => ({ exists: true }),
    getClassInformation: async () => ({
      fileReadOnly: false,
      fileName: "",
      restriction: "package",
    }),
    parseFile: async () => ({ classNames: [] }),
    parseString: async () => ({ classNames: [] }),
    getClassNames: async () => ({ classNames: [] }),
    getErrorString: async () => ({ errorString: "" }),
    loadString: async () => ({ success: true }),
    setSourceFile: async () => ({ success: true }),
    getSourceFile: async () => ({ fileName: "/w/Demo.mo" }),
    listFile: async () => ({ contents: "" }),
    getModelicaPath: async () => ({ modelicaPath: "/usr/lib/omlibrary" }),
    ...overrides,
  };
}

/** The `ZodError` a real `entry.inputSchema.parse(input)` failure throws. */
function zodFailure(schema: z.ZodTypeAny, input: unknown): z.ZodError {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("expected the parse to fail");
  return result.error;
}

const verdicts: WriteVerdictSource = {
  forClass: async () => ({ ok: true }),
};

function text(result: {
  content: readonly { type: string; text?: string }[];
}): string {
  const [first] = result.content;
  if (first?.type !== "text" || first.text === undefined) {
    throw new Error("no text content");
  }
  return first.text;
}

describe("dispatchByName's error-buffer drain under concurrency", () => {
  it("does not let a slow call in flight lose its own diagnostic to a faster call's clear", async () => {
    // OMC really did leave a diagnostic as part of executing the slow call —
    // simulated here by setting the buffer as soon as its `invoke` runs —
    // but that call's own round trip is still pending when a second, faster
    // call starts. Without a lock around the whole clear-invoke-read
    // sequence, the faster call's own clear wipes the slow call's diagnostic
    // before the slow call ever reads it back.
    let buffer = "";
    let releaseSlow: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    let signalReachedGate: () => void = () => undefined;
    const reachedGate = new Promise<void>((resolve) => {
      signalReachedGate = resolve;
    });

    const client = baseClient({
      getErrorString: async () => {
        const errorString = buffer;
        buffer = "";
        return { errorString };
      },
      invoke: async (fn) => {
        if (fn === "addComponent") {
          buffer = "Error: An element with name R is already declared";
          signalReachedGate();
          await gate;
        }
        return { ok: true };
      },
    });
    const deps: McpToolDeps = { ensureClient: async () => client, verdicts };

    const slow = dispatchByName(deps, "addComponent", {
      componentName: "r1",
      componentClass: "Modelica.Electrical.Analog.Basic.Resistor",
      intoTypeName: "Demo.Circuit",
    });
    // Wait until the slow call has left its diagnostic and is blocked mid
    // round trip before starting the fast one, so the fast call's own
    // clear-invoke-read genuinely races the slow call's still-pending read.
    await reachedGate;
    const fastPromise = dispatchByName(deps, "getClassNames", {
      typeName: "Demo",
    });
    releaseSlow();
    const [slowResult, fast] = await Promise.all([slow, fastPromise]);

    expect(slowResult.isError).toBe(true);
    expect(text(slowResult)).toBe(
      "Error: An element with name R is already declared",
    );
    expect(fast.isError).toBeFalsy();
    expect(text(fast)).not.toContain("R is already declared");
  });

  it("does not let a queued getErrorString read steal a mutation's own diagnostic", async () => {
    // getErrorString is exempt from withErrorBuffer's own clear/drain (it IS
    // the read), but it must still queue behind an in-flight mutation's turn
    // — otherwise it can run between that mutation's invoke and its drain
    // and read the diagnostic before the mutation ever sees it.
    let buffer = "";
    let releaseSlow: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    let signalReachedGate: () => void = () => undefined;
    const reachedGate = new Promise<void>((resolve) => {
      signalReachedGate = resolve;
    });

    const client = baseClient({
      getErrorString: async () => {
        const errorString = buffer;
        buffer = "";
        return { errorString };
      },
      invoke: async (fn) => {
        if (fn === "addComponent") {
          buffer = "Error: An element with name R is already declared";
          signalReachedGate();
          await gate;
          return { ok: true };
        }
        if (fn === "getErrorString") {
          const errorString = buffer;
          buffer = "";
          return { errorString };
        }
        return { ok: true };
      },
    });
    const deps: McpToolDeps = { ensureClient: async () => client, verdicts };

    const slow = dispatchByName(deps, "addComponent", {
      componentName: "r1",
      componentClass: "Modelica.Electrical.Analog.Basic.Resistor",
      intoTypeName: "Demo.Circuit",
    });
    await reachedGate;
    const readPromise = dispatchByName(deps, "getErrorString", {});
    releaseSlow();
    const [slowResult, read] = await Promise.all([slow, readPromise]);

    expect(slowResult.isError).toBe(true);
    expect(text(slowResult)).toBe(
      "Error: An element with name R is already declared",
    );
    expect(JSON.parse(text(read))).toEqual({ errorString: "" });
  });
});

describe("dispatchByName's logging and failure notification", () => {
  function makeLog(): {
    log: { warn: (m: string) => void; info: (m: string) => void };
    warnings: string[];
    infos: string[];
  } {
    const warnings: string[] = [];
    const infos: string[] = [];
    return {
      log: {
        warn: (m) => warnings.push(m),
        info: (m) => infos.push(m),
      },
      warnings,
      infos,
    };
  }

  it("logs a successful call's action and output, without notifying", async () => {
    const { log, infos, warnings } = makeLog();
    const notified: string[] = [];
    const client = baseClient();
    const deps: McpToolDeps = {
      ensureClient: async () => client,
      verdicts,
      log,
      notifyFailure: (m) => notified.push(m),
    };

    await dispatchByName(deps, "getClassNames", { typeName: "Demo" });

    expect(warnings).toEqual([]);
    expect(infos).toHaveLength(1);
    expect(infos[0]).toContain("getClassNames");
    expect(infos[0]).toContain("Demo");
    expect(notified).toEqual([]);
  });

  it("logs and notifies a call OMC left a diagnostic for", async () => {
    const { log, warnings } = makeLog();
    const notified: string[] = [];
    const client = baseClient({
      getErrorString: async () => ({
        errorString: "Error: An element with name R is already declared",
      }),
    });
    const deps: McpToolDeps = {
      ensureClient: async () => client,
      verdicts,
      log,
      notifyFailure: (m) => notified.push(m),
    };

    await dispatchByName(deps, "addComponent", {
      componentName: "r1",
      componentClass: "Modelica.Electrical.Analog.Basic.Resistor",
      intoTypeName: "Demo.Circuit",
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("addComponent");
    expect(warnings[0]).toContain("already declared");
    expect(notified).toHaveLength(1);
    expect(notified[0]).toContain("already declared");
  });

  it("logs a failed read without notifying", async () => {
    // A model probing names fails a read per miss; a toast apiece would bury
    // the user under answers the model can act on itself.
    const { log, warnings } = makeLog();
    const notified: string[] = [];
    const client = baseClient({
      getErrorString: async () => ({
        errorString: "Error: Class Demo.Nope not found",
      }),
    });
    const deps: McpToolDeps = {
      ensureClient: async () => client,
      verdicts,
      log,
      notifyFailure: (m) => notified.push(m),
    };

    const result = await dispatchByName(deps, "getClassInformation", {
      typeName: "Demo.Nope",
    });

    expect(result.isError).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("not found");
    expect(notified).toEqual([]);
  });

  it("keeps a read's malformed argument between the model and the tool", async () => {
    // `omc_invoke` screens argument names, not their types, so a wrong-typed
    // value reaches `invoke`'s own parse. Nothing was written, and the tool
    // description tells the model to iterate on the shape.
    const { log, warnings } = makeLog();
    const notified: string[] = [];
    const client = baseClient({
      invoke: async () => {
        throw zodFailure(REGISTRY.getElements.inputSchema, { typeName: 42 });
      },
    });
    const deps: McpToolDeps = {
      ensureClient: async () => client,
      verdicts,
      log,
      notifyFailure: (m) => notified.push(m),
    };

    await dispatchByName(deps, "getElements", { typeName: 42 });

    expect(warnings).toHaveLength(1);
    expect(notified).toEqual([]);
  });

  it("notifies a read that failed for something other than OMC's answer", async () => {
    // A dead client is the user's to see; only OMC's own diagnostic stays
    // between the model and the tool.
    const { log, warnings } = makeLog();
    const notified: string[] = [];
    const client = baseClient({
      invoke: async () => {
        throw new Error("omc client closed");
      },
    });
    const deps: McpToolDeps = {
      ensureClient: async () => client,
      verdicts,
      log,
      notifyFailure: (m) => notified.push(m),
    };

    await dispatchByName(deps, "getClassInformation", { typeName: "Demo" });

    expect(warnings).toHaveLength(1);
    expect(notified).toHaveLength(1);
    expect(notified[0]).toContain("omc client closed");
  });

  it("keeps a read that raised OMC's reason itself between the model and the tool", async () => {
    // A wrapper that reads the buffer itself throws `OmcDiagnosticError`, so
    // its failure is classified the way `invokeDrained`'s own would be.
    const { log, warnings } = makeLog();
    const notified: string[] = [];
    const client = baseClient({
      invoke: async () => {
        throw new OmcDiagnosticError(
          "readSimulationResultVars: Error: Failed to open simulation result gone.mat",
        );
      },
    });
    const deps: McpToolDeps = {
      ensureClient: async () => client,
      verdicts,
      log,
      notifyFailure: (m) => notified.push(m),
    };

    const result = await dispatchByName(deps, "readSimulationResultVars", {
      fileName: "gone.mat",
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Failed to open simulation result");
    expect(warnings).toHaveLength(1);
    expect(notified).toEqual([]);
  });

  it("notifies a mutation that raised OMC's reason itself, unlike a read", async () => {
    // parseMutationSuccess throws the same OmcDiagnosticError type a read's
    // failure does, so `isReadOnlyFunction(fn)` — not the error type — is
    // what keeps this one from going quiet the way the read above does.
    const { log, warnings } = makeLog();
    const notified: string[] = [];
    const client = baseClient({
      invoke: async () => {
        throw new OmcDiagnosticError("deleteClass: Demo.Foo is protected");
      },
    });
    const deps: McpToolDeps = {
      ensureClient: async () => client,
      verdicts,
      log,
      notifyFailure: (m) => notified.push(m),
    };

    const result = await dispatchByName(deps, "deleteClass", {
      typeName: "Demo.Foo",
    });

    expect(result.isError).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(notified).toHaveLength(1);
    expect(notified[0]).toContain("is protected");
  });

  it("logs and notifies a write-gate refusal", async () => {
    const { log, warnings } = makeLog();
    const notified: string[] = [];
    const client = baseClient();
    const refusingVerdicts: WriteVerdictSource = {
      forClass: async () => ({ ok: false, reason: "not your class to edit" }),
    };
    const deps: McpToolDeps = {
      ensureClient: async () => client,
      verdicts: refusingVerdicts,
      log,
      notifyFailure: (m) => notified.push(m),
    };

    await dispatchByName(deps, "addComponent", {
      componentName: "r1",
      componentClass: "Modelica.Electrical.Analog.Basic.Resistor",
      intoTypeName: "Demo.Circuit",
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("refused");
    expect(notified).toHaveLength(1);
    expect(notified[0]).toContain("not your class to edit");
  });

  it("truncates a huge logged value instead of flooding the channel", async () => {
    const { log, infos } = makeLog();
    const huge = "x".repeat(5000);
    const client = baseClient({ invoke: async () => ({ contents: huge }) });
    const deps: McpToolDeps = {
      ensureClient: async () => client,
      verdicts,
      log,
    };

    await dispatchByName(deps, "listFile", { typeName: "Demo" });

    expect(infos).toHaveLength(1);
    expect(infos[0]?.length).toBeLessThan(huge.length);
    expect(infos[0]).toContain("chars total");
  });

  it("works with neither log nor notifyFailure wired", async () => {
    const client = baseClient();
    const deps: McpToolDeps = { ensureClient: async () => client, verdicts };

    const result = await dispatchByName(deps, "getClassNames", {
      typeName: "Demo",
    });

    expect(result.isError).toBeFalsy();
  });
});

describe("dispatchByName: destination gate origin-check atomicity (issue #730)", () => {
  // Real directories: `isUnderSystemLibraryRoot` walks them with `fs.realpath`,
  // and that real I/O is what makes this test deterministic rather than
  // timing-dependent — see the comment on `cd` below.
  let workspaceDir: string;
  let libraryRoot: string;

  beforeEach(async () => {
    workspaceDir = await fsp.mkdtemp(path.join(os.tmpdir(), "mw-dispatch-ws-"));
    libraryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "mw-dispatch-lib-"));
  });

  afterEach(async () => {
    await fsp.rm(workspaceDir, { recursive: true, force: true });
    await fsp.rm(libraryRoot, { recursive: true, force: true });
  });

  it("does not let an interleaved cd move OMC's cwd between the destination gate's check and the write it guards", async () => {
    let cwd = workspaceDir;
    const writes: string[] = [];

    let releaseGateRead: () => void = () => undefined;
    const gateReadPaused = new Promise<void>((resolve) => {
      releaseGateRead = resolve;
    });
    let signalGateReading: () => void = () => undefined;
    const gateReading = new Promise<void>((resolve) => {
      signalGateReading = resolve;
    });

    const client = baseClient({
      getModelicaPath: async () => ({ modelicaPath: libraryRoot }),
      cd: async ({ newWorkingDirectory }) => {
        if (newWorkingDirectory !== "") {
          cwd = newWorkingDirectory;
          return { workingDirectory: cwd };
        }
        // The gate's own origin read: answer with the cwd that was actually
        // current when it was asked, then pause before returning to open the
        // exact window an interleaved `cd` (issue #730) would use — real
        // `fsp.realpath` calls inside `isUnderSystemLibraryRoot` open the
        // same kind of window on every run even without this pause, but not
        // on a schedule a test can pin.
        const answeredWith = cwd;
        signalGateReading();
        await gateReadPaused;
        return { workingDirectory: answeredWith };
      },
      invoke: async (fn, input) => {
        if (fn === "cd") {
          const { newWorkingDirectory } = input as {
            newWorkingDirectory: string;
          };
          cwd = newWorkingDirectory;
          return { workingDirectory: cwd };
        }
        if (fn === "filterSimulationResults") {
          const { outFile } = input as { outFile: string };
          // OMC resolves a relative destination against its real, current
          // working directory at the moment it performs the write — not
          // whatever the gate observed when it decided the call was safe.
          writes.push(path.resolve(cwd, outFile));
          return { fileName: outFile };
        }
        return { ok: true };
      },
    });
    const deps: McpToolDeps = { ensureClient: async () => client, verdicts };

    const guarded = dispatchByName(deps, "filterSimulationResults", {
      inFile: "/workspace/res.mat",
      outFile: "filtered.mat",
      vars: ["x"],
    });
    await gateReading;
    // An ungated `cd` dispatch sharing the same client, fired while the
    // guarded call's own origin check is paused mid-turn — not awaited here:
    // under the fix it cannot even start until the guarded call's whole turn
    // (check + write) finishes, so awaiting it before releasing the gate
    // would deadlock the test against the very property it's proving.
    const attackerCd = dispatchByName(deps, "cd", {
      newWorkingDirectory: libraryRoot,
    });
    releaseGateRead();
    const [guardedResult] = await Promise.all([guarded, attackerCd]);

    expect(guardedResult.isError).toBeFalsy();
    // The write must land where the gate actually checked it (workspaceDir),
    // never under the library root the interleaved `cd` moved OMC to.
    expect(writes).toEqual([path.join(workspaceDir, "filtered.mat")]);
  });
});

describe("dispatchByName: simulation result precision (issue #719)", () => {
  const deps = (invoke: McpToolClient["invoke"]): McpToolDeps => ({
    ensureClient: async () => baseClient({ invoke }),
    verdicts,
  });

  it("sends readSimulationResult's numbers without float-repr tail digits", async () => {
    const result = await dispatchByName(
      deps(async () => ({
        result: [[0.1 + 0.2, 0.00030000000000000003, 1.23456789e-9]],
      })),
      "readSimulationResult",
      { filename: "r.mat", variables: ["time"] },
    );

    expect(text(result)).toBe('{"result":[[0.3,0.0003,1.23457e-9]]}');
  });

  it("leaves another function's numbers at full precision", async () => {
    const result = await dispatchByName(
      deps(async () => ({ result: [[0.1 + 0.2]] })),
      "val",
      { varName: "x", timeStamp: 0 },
    );

    expect(text(result)).toBe(`{"result":[[${0.1 + 0.2}]]}`);
  });
});
