/**
 * The single path from an MCP tool call to OMC.
 *
 * Every tool — the parity wrappers, the shape tools, `omc_invoke` — ends here,
 * so the write gate and the choice of dispatcher are made once. Dispatch is
 * through `invoke()`, never `call()`: `call()` takes a raw command string and
 * skips input validation entirely.
 *
 * Nothing here wires a refresh. `publishOmcMutations` announces whatever a call
 * mutated from inside the client, so a mutating tool inherits invalidation by
 * making the call.
 */

import type {
  DeclareClient,
  OmcFnName,
  OmcInput,
  PersistClient,
  RootPackageClient,
  SaveClient,
  SourceTree,
} from "@dicode/omc-client";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { errorDetail } from "./error-detail.js";
import type {
  WriteAction,
  WriteVerdictClient,
  WriteVerdictSource,
} from "./write-verdict.js";
import {
  refusalFor,
  refusalForClass,
  type WriteTargetClient,
} from "./write-gate.js";

/**
 * The subset of `OmcClient` the MCP tools call.
 *
 * `invoke` carries every published wrapper. The typed methods beside it are
 * the ones `createClass` composes by hand, and they are declared for the same
 * reason {@link dispatch} is: a renamed argument fails the build rather than
 * reaching a model. `existClass` arrives through `WriteTargetClient`, where the
 * gate needs it; `createClass` and `saveClass` call it too. `cd` is the host's,
 * called once per client to park OMC's working directory.
 */
export interface McpToolClient
  extends
    WriteVerdictClient,
    WriteTargetClient,
    PersistClient,
    RootPackageClient,
    SaveClient,
    DeclareClient {
  invoke(fn: OmcFnName, input: unknown): Promise<unknown>;
  cd(input: {
    newWorkingDirectory: string;
  }): Promise<{ workingDirectory: string }>;
  deleteClass(input: { typeName: string }): Promise<{ success: boolean }>;
  /** Narrows the bases, which disagree on which fields they need. */
  getClassInformation(input: { typeName: string }): Promise<{
    fileReadOnly: boolean;
    fileName: string;
    restriction: string;
  }>;
  /** Narrows the bases, which disagree on whether `parseFile` takes an encoding. */
  parseFile(input: {
    fileName: string;
    encoding?: string;
  }): Promise<{ classNames: string[] }>;
}

export interface McpToolDeps {
  /** Spawns OMC on first use; a tool call is the earliest this may happen. */
  ensureClient: () => Promise<McpToolClient>;
  verdicts: WriteVerdictSource;
  /**
   * Where a created class is written. Nothing derivable from OMC decides
   * this, so the host does; every file `createClass` creates goes through the
   * host's writer. Absent when the host has nowhere to write, which
   * `createClass` reports to the caller.
   */
  workspace?: SourceTree | undefined;
}

/** A class a tool writes that nothing in its wrapper's arguments names. */
export interface GatedClass {
  readonly className: string;
  readonly action: WriteAction;
}

/** A tool result carrying `text` as the model's answer. */
export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

/** A tool result the model is told failed, carrying `message` as the reason. */
export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Functions that read OMC's own error buffer rather than mutate a model.
 *
 * {@link dispatchByName}'s drain would defeat either of these: clearing the
 * buffer immediately before the call empties out the very thing the caller
 * asked to read.
 */
const READS_ERROR_BUFFER = new Set<OmcFnName>([
  "getErrorString",
  "getMessagesStringInternal",
]);

/**
 * Whether a drained error buffer reports a failure rather than a warning or
 * notification left behind by a call that otherwise succeeded — `simulate`
 * and `checkModel` routinely leave one of those on a model that built fine.
 * Mirrors the heuristic `packages/extension/src/repl/repl-eval.ts` already
 * uses on the same buffer: OMC's diagnostic-level marker is the literal word
 * "Error".
 */
function looksLikeError(errorString: string): boolean {
  return /\bError\b/.test(errorString);
}

/**
 * Serializes {@link dispatchByName}'s clear-invoke-read sequence so two
 * calls racing each other never interleave it.
 *
 * OMC is one process per window (`http-host.ts`), and its error buffer is
 * one bit of shared, ungated state on it — the MCP SDK dispatches concurrent
 * tool calls without waiting for one to finish, so without this a second
 * call's clear can erase the first's diagnostic before the first reads it
 * back, or a second call's read can pick up the first's diagnostic as its
 * own.
 */
let errorBufferTurn: Promise<unknown> = Promise.resolve();

async function withErrorBuffer<T>(run: () => Promise<T>): Promise<T> {
  const turn = errorBufferTurn.then(run, run);
  errorBufferTurn = turn.then(
    () => undefined,
    () => undefined,
  );
  return turn;
}

/**
 * Run `fn` with `input`, refusing first if the class it would write is not the
 * user's to change.
 *
 * `input` is checked against the function's own type, which is what makes the
 * compiler the drift check for every tool that composes a call at authoring
 * time — the seven shape tools build a `writeClassGraphics` op by hand, and a
 * renamed field in that op would otherwise reach a model before it reached a
 * test. {@link dispatchByName} is the way in for a name only known at runtime.
 */
export async function dispatch<K extends OmcFnName>(
  deps: McpToolDeps,
  fn: K,
  input: OmcInput<K>,
): Promise<CallToolResult> {
  return dispatchByName(deps, fn, input);
}

/**
 * {@link dispatch} for a function named by the caller rather than by the code:
 * the parity tools, which loop over their own list, and `omc_invoke`.
 *
 * `gateOn` adds a class the tool knows it writes to the ones the gate derives
 * from the arguments themselves. `setSourceCode` needs it: the gate judges the
 * classes its code declares, and `className` names a further one — the class
 * whose file the reload takes over, which the code need not declare.
 *
 * An OMC failure comes back as an error result rather than a thrown protocol
 * error: "no such class" is an answer the model can act on, not a transport
 * fault.
 *
 * Many OMC mutations answer `success: true` (or nothing distinguishing at
 * all) for a call that did nothing, and stash the actual reason in OMC's own
 * error buffer instead of the return value — `addComponent` of a duplicate
 * name is one. The buffer is drained around every call not itself reading
 * it: cleared before, so a stale message from an earlier call cannot be
 * mistaken for this one's, and read again after, so a message OMC marks as
 * an error becomes this call's error rather than a silently accepted
 * success. A warning or notification left in the same buffer does not —
 * {@link looksLikeError} is what tells the two apart.
 */
export async function dispatchByName(
  deps: McpToolDeps,
  fn: OmcFnName,
  input: unknown,
  gateOn?: GatedClass,
): Promise<CallToolResult> {
  try {
    const client = await deps.ensureClient();
    const refusal =
      (await refusalFor(deps.verdicts, client, fn, input)) ??
      (gateOn === undefined
        ? undefined
        : await refusalForClass(
            deps.verdicts,
            client,
            gateOn.className,
            gateOn.action,
          ));
    if (refusal !== undefined) return errorResult(refusal);

    const output = READS_ERROR_BUFFER.has(fn)
      ? await client.invoke(fn, input)
      : await withErrorBuffer(async () => {
          await client.getErrorString();
          const result = await client.invoke(fn, input);
          const { errorString } = await client.getErrorString();
          if (looksLikeError(errorString)) throw new Error(errorString);
          return result;
        });
    return textResult(JSON.stringify(output));
  } catch (err) {
    return errorResult(errorDetail(err, fn));
  }
}
