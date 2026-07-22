/**
 * Lazily spawns a single OMC client and coalesces concurrent callers onto it.
 *
 * At activation several independent callers reach for the client at once —
 * workspace autoload, the library tree mount, the `.mo` watcher's index seed, a
 * restored diagram tab. A plain `if (client) …; client = await spawn()` lets
 * every caller that arrives before the first spawn resolves start its own OMC
 * process; a load landing in one is then invisible to a read served by another,
 * so the sidebar comes up empty. Sharing the in-flight spawn promise keeps them
 * on one process.
 */

export interface OmcClientCache<T> {
  /** The shared client, spawning it (once) on first call. */
  ensure(): Promise<T>;
  /** Close the current client and spawn a fresh one. */
  reset(): Promise<T>;
  /** Close the current client, if any. */
  close(): Promise<void>;
}

export function createOmcClientCache<T>(
  spawn: () => Promise<T>,
  closeClient: (client: T) => Promise<void>,
): OmcClientCache<T> {
  let client: T | undefined;
  let inFlight: Promise<T> | undefined;

  function ensure(): Promise<T> {
    if (client !== undefined) return Promise.resolve(client);
    if (inFlight === undefined) {
      inFlight = spawn().then((c) => {
        client = c;
        return c;
      });
      // On failure clear the in-flight promise so a later call can respawn.
      void inFlight.catch(() => {
        inFlight = undefined;
      });
    }
    return inFlight;
  }

  async function close(): Promise<void> {
    inFlight = undefined;
    if (client !== undefined) {
      const c = client;
      client = undefined;
      await closeClient(c);
    }
  }

  async function reset(): Promise<T> {
    await close();
    return ensure();
  }

  return { ensure, reset, close };
}
