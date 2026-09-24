/**
 * OMC reports several mutation failures through its own error buffer
 * (`getErrorString`) rather than through a call's own return value — a
 * `success: true` reply, or one indistinguishable from a clean run, can
 * still mean nothing happened, with the real reason sitting undrained.
 *
 * The MCP server's dispatcher, the extension's REPL and its diagram editor
 * all drain that buffer on one shared OmcClient instance (the extension
 * embeds the MCP server on the client the other two use), so two of them
 * racing each other could clear or read one another's diagnostic. The queue
 * below is keyed by client instance so every caller routed through this
 * module serializes against the others. A `getErrorString` or
 * `getMessagesStringInternal` call made directly on the client does not take
 * a turn and can still land inside one.
 */

import { SerialQueue } from "./queue.js";

export interface ErrorBufferClient {
  getErrorString(): Promise<{ errorString: string }>;
}

/**
 * OMC's diagnostic-level marker for a hard failure. `simulate` and
 * `checkModel` routinely leave a warning or notice in the same buffer on a
 * model that built fine, so the literal word "Error" — not mere non-empty
 * text — is what tells the two apart.
 */
export function looksLikeError(errorString: string): boolean {
  return /\bError\b/.test(errorString);
}

/**
 * Anchored form of the same diagnostic-level marker: true only when the
 * diagnostic shape leads the text, not merely appears somewhere inside it.
 * Distinguishes OMC's own diagnostic replies from a value whose text simply
 * contains "Error" — a dotted class name, a string literal, an annotation
 * body — which is not a diagnostic and must not be read as one.
 */
export function startsWithError(text: string): boolean {
  return /^Error\b/.test(text);
}

/**
 * A failure OMC reported through its error buffer rather than by throwing.
 * Distinguishes an answer the caller can act on from a transport fault or a
 * dead client, which reach the same `catch`.
 */
export class OmcDiagnosticError extends Error {}

/**
 * One turn queue per client instance, keyed by identity (a `WeakMap`) so
 * unrelated `OmcClient` instances — e.g. one per test — never share a queue.
 */
const turns = new WeakMap<ErrorBufferClient, SerialQueue>();

function turnQueue(client: ErrorBufferClient): SerialQueue {
  let queue = turns.get(client);
  if (queue === undefined) {
    queue = new SerialQueue();
    turns.set(client, queue);
  }
  return queue;
}

/**
 * Runs `run` with `client`'s error buffer cleared immediately before and
 * drained immediately after, the whole transaction serialized against any
 * other call sharing `client` through this same function. Returns `run`'s
 * result alongside whatever text was left in the buffer afterward — `""`
 * when OMC reported nothing.
 *
 * The pre-call clear matters as much as the post-call read: without it, a
 * message an unrelated earlier call left behind could be misread as this
 * call's own. Callers that need to read the buffer on purpose (an explicit
 * `getErrorString` or `getMessagesStringInternal`) must not route through
 * here — doing so would drain the very thing they're asking for; use
 * {@link runQueued} instead.
 */
export function withErrorBuffer<T>(
  client: ErrorBufferClient,
  run: () => Promise<T>,
): Promise<{ result: T; errorString: string }> {
  return turnQueue(client).run(async () => {
    await client.getErrorString();
    let result: T;
    try {
      result = await run();
    } catch (error) {
      // OMC can have executed the mutation and left a diagnostic before the
      // call itself rejected, so still drain it — otherwise the next turn on
      // this queue (a runQueued read especially, which skips its own clear)
      // inherits a diagnostic that was never its own. The original rejection
      // is what the caller needs to see, not a failure from this cleanup.
      await client.getErrorString().catch(() => undefined);
      throw error;
    }
    const { errorString } = await client.getErrorString();
    return { result, errorString };
  });
}

/**
 * Runs `run` on the same per-client turn queue {@link withErrorBuffer} uses,
 * without an extra clear or drain of its own. A direct `getErrorString` or
 * `getMessagesStringInternal` call that skipped the queue entirely could
 * still land between a queued mutation's own run and its final drain,
 * consuming the diagnostic that mutation is waiting to read back.
 */
export function runQueued<T>(
  client: ErrorBufferClient,
  run: () => Promise<T>,
): Promise<T> {
  return turnQueue(client).run(run);
}
