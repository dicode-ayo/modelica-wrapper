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
  SourceTree,
} from "@dicode/omc-client";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { errorDetail } from "./error-detail.js";
import type {
  WriteAction,
  WriteVerdictClient,
  WriteVerdictSource,
} from "./write-verdict.js";
import { refusalFor, refusalForClass } from "./write-gate.js";

/**
 * The subset of `OmcClient` the MCP tools call.
 *
 * `invoke` carries every published wrapper. The typed methods beside it are
 * the ones `createClass` composes by hand, and they are declared for the same
 * reason {@link dispatch} is: a renamed argument fails the build rather than
 * reaching a model.
 */
export interface McpToolClient
  extends WriteVerdictClient, PersistClient, RootPackageClient, DeclareClient {
  invoke(fn: OmcFnName, input: unknown): Promise<unknown>;
  deleteClass(input: { typeName: string }): Promise<{ success: boolean }>;
  existClass(input: { typeName: string }): Promise<{ exists: boolean }>;
  /** Narrows the bases, which disagree on which fields they need. */
  getClassInformation(input: { typeName: string }): Promise<{
    fileReadOnly: boolean;
    fileName: string;
    restriction: string;
  }>;
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

/** The class a tool writes, when its wrapper's arguments do not name one. */
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
 * `gateOn` is for a tool that knows the class it writes when the wrapper it
 * dispatches does not carry one in its arguments — `setSourceCode` over
 * `loadString` is the case that needs it.
 *
 * An OMC failure comes back as an error result rather than a thrown protocol
 * error: "no such class" is an answer the model can act on, not a transport
 * fault.
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
      gateOn === undefined
        ? await refusalFor(deps.verdicts, client, fn, input)
        : await refusalForClass(
            deps.verdicts,
            client,
            gateOn.className,
            gateOn.action,
          );
    if (refusal !== undefined) return errorResult(refusal);

    const output = await client.invoke(fn, input);
    return textResult(JSON.stringify(output));
  } catch (err) {
    return errorResult(errorDetail(err));
  }
}
