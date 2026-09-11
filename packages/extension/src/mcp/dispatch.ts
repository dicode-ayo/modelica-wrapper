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

import type { OmcFnName, OmcInput, OmcOutput } from "@dicode/omc-client";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { errorDetail } from "../error-detail.js";
import type { WriteVerdictClient } from "../write-verdict.js";
import { refusalFor, type WriteVerdictSource } from "./write-gate.js";

/** The subset of `OmcClient` the MCP tools call. */
export interface McpToolClient extends WriteVerdictClient {
  invoke<K extends OmcFnName>(fn: K, input: OmcInput<K>): Promise<OmcOutput<K>>;
}

export interface McpToolDeps {
  /** Spawns OMC on first use; a tool call is the earliest this may happen. */
  ensureClient: () => Promise<McpToolClient>;
  verdicts: WriteVerdictSource;
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
 * An OMC failure comes back as an error result rather than a thrown protocol
 * error: "no such class" is an answer the model can act on, not a transport
 * fault.
 */
export async function dispatch(
  deps: McpToolDeps,
  fn: OmcFnName,
  input: unknown,
): Promise<CallToolResult> {
  try {
    const client = await deps.ensureClient();
    const refusal = await refusalFor(deps.verdicts, client, fn, input);
    if (refusal !== undefined) return errorResult(refusal);

    // The registry pairs each name with its own input type by construction;
    // a name only known at runtime erases that, so the call shape is widened
    // the way `OmcClient.invoke` widens its own dispatch.
    type AnyInvoke = (fn: OmcFnName, input: unknown) => Promise<unknown>;
    const output = await (client.invoke as AnyInvoke)(fn, input);
    return textResult(JSON.stringify(output, null, 2));
  } catch (err) {
    return errorResult(errorDetail(err));
  }
}
