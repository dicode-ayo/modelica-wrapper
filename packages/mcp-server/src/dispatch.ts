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
import { looksLikeError, withErrorBuffer } from "@dicode/omc-client";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { errorDetail } from "./error-detail.js";
import type { McpLog } from "./log.js";
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
  /**
   * Where every dispatched call, its outcome, and any refusal are logged —
   * the extension wires this to its own output channel (`createMcpHttpHost`'s
   * `parked`). Absent in a host with nowhere to log to, or a test that
   * doesn't care; {@link dispatchByName} treats it as optional throughout.
   */
  log?: McpLog | undefined;
  /**
   * Surfaces a refusal or a hard failure somewhere more visible than the log
   * channel — the extension wires this to a VSCode error notification. An
   * MCP tool call has no REPL transcript or webview of its own for a user to
   * notice a failure in, unlike the extension's own diagram editor and REPL,
   * so this is the surface that fills the same role there. Never called for
   * a successful call.
   */
  notifyFailure?: ((message: string) => void) | undefined;
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
 * Bounds a value logged to the output channel — a class dump or a full
 * source string can run past 300 KB (issue #658), which would otherwise
 * flood the channel for one call.
 */
const MAX_LOGGED_CHARS = 2000;

function loggable(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > MAX_LOGGED_CHARS
    ? `${text.slice(0, MAX_LOGGED_CHARS)}… (${text.length} chars total)`
    : text;
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
 * name is one. `withErrorBuffer` (`@dicode/omc-client`) drains the buffer
 * around every call not itself reading it, serialized against every other
 * caller sharing this same client — the extension's REPL and diagram editor
 * included, since the extension embeds this server on the same OmcClient
 * instance those use.
 *
 * Every call, its outcome, and any refusal are logged via `deps.log` — an MCP
 * tool call has no REPL transcript or webview of its own to show up in, so
 * the output channel is the only place a user watching the extension sees
 * what an agent actually did. A refusal or a hard failure additionally goes
 * to `deps.notifyFailure`, the same visibility the extension's own REPL and
 * diagram editor get from their transcripts.
 */
export async function dispatchByName(
  deps: McpToolDeps,
  fn: OmcFnName,
  input: unknown,
  gateOn?: GatedClass,
): Promise<CallToolResult> {
  const { log, notifyFailure } = deps;
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
    if (refusal !== undefined) {
      log?.warn(`${fn} ${loggable(input)} refused: ${refusal}`);
      notifyFailure?.(`${fn} refused: ${refusal}`);
      return errorResult(refusal);
    }

    if (READS_ERROR_BUFFER.has(fn)) {
      const output = await client.invoke(fn, input);
      log?.info(`${fn} ${loggable(input)} -> ${loggable(output)}`);
      return textResult(JSON.stringify(output));
    }
    const { result, errorString } = await withErrorBuffer(client, () =>
      client.invoke(fn, input),
    );
    if (looksLikeError(errorString)) throw new Error(errorString);
    log?.info(`${fn} ${loggable(input)} -> ${loggable(result)}`);
    return textResult(JSON.stringify(result));
  } catch (err) {
    const message = errorDetail(err, fn);
    log?.warn(`${fn} ${loggable(input)} failed: ${message}`);
    notifyFailure?.(`${fn} failed: ${message}`);
    return errorResult(message);
  }
}
