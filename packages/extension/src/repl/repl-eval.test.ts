/**
 * Unit tests for the REPL line evaluator.
 *
 * `evalLine` only ever reaches OMC through the injected dependencies, so we
 * mock `OmcClient` with a minimal fake that records calls and replays
 * scripted responses. The integration test under `repl-eval.integration.test.ts`
 * exercises the same path with a real OMC subprocess.
 */

import { describe, expect, it } from "vitest";

import type { OmcClient } from "@dicode/omc-client";

import { HELP_TEXT, evalLine, type ReplDependencies } from "./repl-eval.js";
import { META_COMMANDS } from "./repl-help.js";

interface FakeClient {
  client: OmcClient;
  calls: string[];
  loadFileCalls: string[];
  cdCalls: string[];
  /** Push a string here to make the next `getErrorString()` return non-empty. */
  errorQueue: string[];
  /** Replies for `call()` keyed by command — falls back to "" if missing. */
  callReplies: Map<string, string>;
  /** Replies for `cd({ newWorkingDirectory })` keyed by input path. */
  cdReplies: Map<string, string>;
  /** Replies for `loadFile()` — defaults to success=true. */
  loadFileSuccess: boolean;
  loadFileError?: string;
}

function makeClient(opts: { loadFileSuccess?: boolean } = {}): FakeClient {
  const calls: string[] = [];
  const loadFileCalls: string[] = [];
  const cdCalls: string[] = [];
  const errorQueue: string[] = [];
  const callReplies = new Map<string, string>();
  const cdReplies = new Map<string, string>();
  const state: FakeClient = {
    calls,
    loadFileCalls,
    cdCalls,
    errorQueue,
    callReplies,
    cdReplies,
    loadFileSuccess: opts.loadFileSuccess ?? true,
    client: undefined as unknown as OmcClient,
  };
  state.client = {
    async call(cmd: string) {
      calls.push(cmd);
      return callReplies.get(cmd) ?? "";
    },
    async getErrorString() {
      const next = errorQueue.shift() ?? "";
      return { errorString: next };
    },
    async loadFile({ fileName }: { fileName: string }) {
      loadFileCalls.push(fileName);
      if (!state.loadFileSuccess && state.loadFileError !== undefined) {
        errorQueue.push(state.loadFileError);
      }
      return { success: state.loadFileSuccess };
    },
    async cd({ newWorkingDirectory }: { newWorkingDirectory?: string } = {}) {
      const arg = newWorkingDirectory ?? "";
      cdCalls.push(arg);
      return { workingDirectory: cdReplies.get(arg) ?? "" };
    },
    async close() {
      /* no-op */
    },
  } as unknown as OmcClient;
  return state;
}

function makeDeps(
  client: OmcClient,
  opts: { resetReturn?: OmcClient } = {},
): {
  deps: ReplDependencies;
  resetCount: number;
} {
  const wrap = { count: 0 };
  const deps: ReplDependencies = {
    ensureClient: async () => client,
    resetClient: async () => {
      wrap.count += 1;
      return opts.resetReturn ?? client;
    },
  };
  return {
    deps,
    get resetCount() {
      return wrap.count;
    },
  };
}

describe("evalLine — plain OMC commands", () => {
  it("forwards the raw line to client.call and returns the reply", async () => {
    const fake = makeClient();
    fake.callReplies.set("getVersion()", '"OpenModelica v1.22.0"');
    const { deps } = makeDeps(fake.client);
    const result = await evalLine("getVersion()", deps);
    expect(fake.calls).toEqual(["getVersion()"]);
    expect(result.output).toBe('"OpenModelica v1.22.0"');
    expect(result.isError).toBe(false);
  });

  it("treats a non-empty error buffer after a call as an error result", async () => {
    const fake = makeClient();
    fake.callReplies.set("bogus", "");
    fake.errorQueue.push(
      "[<interactive>:1:1] Error: Lookup of class bogus failed.",
    );
    const { deps } = makeDeps(fake.client);
    const result = await evalLine("bogus", deps);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("error: ");
    expect(result.output).toContain("Lookup of class bogus failed");
  });

  it("prepends an actionable hint when OMC fails to find a known function", async () => {
    // Simulates the classic quoted-TypeName mistake: the user wraps a
    // dotted Modelica name in quotes, OMC can't match an overload, the
    // diagnoser turns "Class X not found" into an explanatory hint with
    // a corrected call suggestion.
    const fake = makeClient();
    const call =
      'getElementAnnotation("Modelica.Blocks.Examples.PID_Controller")';
    fake.callReplies.set(call, "");
    fake.errorQueue.push(
      "[<interactive>:1:1-1:0:writable] Error: Class getElementAnnotation not found in scope <global scope> (looking for a function or record).",
    );
    const { deps } = makeDeps(fake.client);
    const result = await evalLine(call, deps);
    expect(result.isError).toBe(true);
    // Hint appears BEFORE OMC's raw message so the user reads the
    // explanation first.
    const hintIdx = result.output.indexOf("`getElementAnnotation` exists");
    const omcIdx = result.output.indexOf("OMC said:");
    expect(hintIdx).toBeGreaterThanOrEqual(0);
    expect(omcIdx).toBeGreaterThan(hintIdx);
    // The suggested rewrite has the quotes stripped.
    expect(result.output).toContain(
      "getElementAnnotation(Modelica.Blocks.Examples.PID_Controller)",
    );
    // OMC's original error string is preserved verbatim further down.
    expect(result.output).toContain("not found in scope <global scope>");
  });

  it("returns an empty result for blank input without calling OMC", async () => {
    const fake = makeClient();
    const { deps } = makeDeps(fake.client);
    const result = await evalLine("   ", deps);
    expect(result.output).toBe("");
    expect(result.isError).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  it("captures a thrown error from client.call as an error result", async () => {
    const fake = makeClient();
    fake.client = {
      async call() {
        throw new Error("transport closed");
      },
      async getErrorString() {
        return { errorString: "" };
      },
    } as unknown as OmcClient;
    const { deps } = makeDeps(fake.client);
    const result = await evalLine("getVersion()", deps);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("transport closed");
  });
});

describe("evalLine — meta commands", () => {
  it(":help returns the help banner without touching OMC", async () => {
    const fake = makeClient();
    const { deps } = makeDeps(fake.client);
    const result = await evalLine(":help", deps);
    expect(result.output).toBe(HELP_TEXT);
    expect(result.isError).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  it(":help <fnName> returns the function's signature without touching OMC", async () => {
    const fake = makeClient();
    const { deps } = makeDeps(fake.client);
    const result = await evalLine(":help getClassInformation", deps);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("getClassInformation");
    expect(result.output).toContain("Parameters:");
    expect(result.output).toContain("typeName");
    expect(result.output).toContain("Returns:");
    expect(fake.calls).toHaveLength(0);
  });

  it(":help <category> returns a function list", async () => {
    const fake = makeClient();
    const { deps } = makeDeps(fake.client);
    const result = await evalLine(":help execution", deps);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("execution");
    expect(result.output).toContain("checkModel");
    expect(result.output).toContain("simulate");
  });

  it(":help <unknown> returns an error result", async () => {
    const fake = makeClient();
    const { deps } = makeDeps(fake.client);
    const result = await evalLine(":help definitelyNotAThing", deps);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("definitelyNotAThing");
  });

  it(":clear returns clearScreen=true with no client call", async () => {
    const fake = makeClient();
    const { deps } = makeDeps(fake.client);
    const result = await evalLine(":clear", deps);
    expect(result.clearScreen).toBe(true);
    expect(result.isError).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  it(":exit returns closeTerminal=true", async () => {
    const fake = makeClient();
    const { deps } = makeDeps(fake.client);
    const result = await evalLine(":exit", deps);
    expect(result.closeTerminal).toBe(true);
    expect(result.isError).toBe(false);
  });

  it(":load <path> calls client.loadFile and reports loaded", async () => {
    const fake = makeClient();
    const { deps } = makeDeps(fake.client);
    const result = await evalLine(":load /some/path.mo", deps);
    expect(fake.loadFileCalls).toEqual(["/some/path.mo"]);
    expect(result.output).toBe("loaded");
    expect(result.isError).toBe(false);
  });

  it(":load surfaces an OMC error when loadFile returns success=false", async () => {
    const fake = makeClient({ loadFileSuccess: false });
    fake.loadFileError = "Could not find file /missing.mo.";
    const { deps } = makeDeps(fake.client);
    const result = await evalLine(":load /missing.mo", deps);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("/missing.mo".slice(1)); // path mentioned
    expect(result.output).toContain("loadFile failed");
  });

  it(":load with no arg returns an error", async () => {
    const fake = makeClient();
    const { deps } = makeDeps(fake.client);
    const result = await evalLine(":load", deps);
    expect(result.isError).toBe(true);
    expect(result.output).toContain(":load requires a path");
  });

  it(":load<tab><path> is recognised the same as a space-separated argument", async () => {
    // repl-complete.ts's selectSource splits the verb from its argument on
    // any whitespace; this dispatcher must agree on where the verb ends or
    // a tab-separated line it recognises as :load falls through to
    // "unknown meta-command" here instead.
    const fake = makeClient();
    const { deps } = makeDeps(fake.client);
    const result = await evalLine(":load\t/some/path.mo", deps);
    expect(fake.loadFileCalls).toEqual(["/some/path.mo"]);
    expect(result.output).toBe("loaded");
    expect(result.isError).toBe(false);
  });

  it(":cd <path> routes through the typed cd wrapper and returns the new cwd", async () => {
    const fake = makeClient();
    fake.cdReplies.set("/tmp", "/tmp");
    const { deps } = makeDeps(fake.client);
    const result = await evalLine(":cd /tmp", deps);
    expect(fake.cdCalls).toEqual(["/tmp"]);
    // Must NOT have used the raw call path for our own constructed command.
    expect(fake.calls).toHaveLength(0);
    expect(result.output).toBe("/tmp");
    expect(result.isError).toBe(false);
  });

  it(":cd with no arg prints the current cwd (cd getter)", async () => {
    // OMC's `cd("")` is documented as a pure getter — it returns the
    // current cwd without changing it. The fake encodes that here: the
    // pre-seeded reply for empty string is the current cwd.
    const fake = makeClient();
    fake.cdReplies.set("", "/some/where");
    const { deps } = makeDeps(fake.client);
    const result = await evalLine(":cd", deps);
    expect(fake.cdCalls).toEqual([""]);
    expect(result.output).toBe("/some/where");
    expect(result.isError).toBe(false);
  });

  it(":cd reports an error when the cd wrapper returns an empty cwd", async () => {
    const fake = makeClient();
    fake.cdReplies.set("/nope", "");
    fake.errorQueue.push("Error: Cannot change directory");
    const { deps } = makeDeps(fake.client);
    const result = await evalLine(":cd /nope", deps);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("cd failed");
  });

  it(":reset invokes resetClient", async () => {
    const fake = makeClient();
    const wrap = makeDeps(fake.client);
    const result = await evalLine(":reset", wrap.deps);
    expect(wrap.resetCount).toBe(1);
    expect(result.output).toBe("OMC reset (fresh state)");
    expect(result.isError).toBe(false);
  });

  it("unknown meta-command returns an error result", async () => {
    const fake = makeClient();
    const { deps } = makeDeps(fake.client);
    const result = await evalLine(":bogus", deps);
    expect(result.isError).toBe(true);
    expect(result.output).toContain(":bogus");
    expect(result.output).toContain(":help");
    expect(fake.calls).toHaveLength(0);
  });

  it("dispatches every META_COMMANDS verb to a working handler", async () => {
    // `tsc` already guarantees every META_COMMANDS verb has a META_HANDLERS
    // entry (the Record type in repl-eval.ts). What that guarantee can't
    // catch is a handler that's present but broken against real inputs —
    // this drives each verb through evalLine against the fake client's
    // ordinary defaults and checks it actually succeeds, not just that some
    // handler ran.
    const fake = makeClient();
    fake.cdReplies.set("/tmp", "/tmp");
    const { deps } = makeDeps(fake.client);

    for (const meta of META_COMMANDS) {
      const line = meta.argKind === "path" ? `${meta.name} /tmp` : meta.name;
      const result = await evalLine(line, deps);
      expect(result.output).not.toContain("unknown meta-command");
      expect(result.isError).toBe(false);
    }
  });
});
