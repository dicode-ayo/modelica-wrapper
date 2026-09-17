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
 * below is keyed by client instance so every caller sharing one client
 * serializes against the others.
 */

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
 * One pending transaction per client instance, chained so the next caller's
 * clear/read waits for the previous caller's to finish rather than
 * interleaving with it. Keyed by identity (a `WeakMap`) so unrelated
 * `OmcClient` instances — e.g. one per test — never share a queue.
 */
const turns = new WeakMap<ErrorBufferClient, Promise<unknown>>();

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
 * here — doing so would drain the very thing they're asking for.
 */
export function withErrorBuffer<T>(
  client: ErrorBufferClient,
  run: () => Promise<T>,
): Promise<{ result: T; errorString: string }> {
  const previous = turns.get(client) ?? Promise.resolve();
  const turn = previous.then(async () => {
    await client.getErrorString();
    const result = await run();
    const { errorString } = await client.getErrorString();
    return { result, errorString };
  });
  // Chained regardless of outcome — a rejected turn must not leave the next
  // caller waiting on a promise that will never settle for them.
  turns.set(
    client,
    turn.then(
      () => undefined,
      () => undefined,
    ),
  );
  return turn;
}
