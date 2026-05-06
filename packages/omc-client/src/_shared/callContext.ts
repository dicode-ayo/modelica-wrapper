import type { OmcCommand } from "../commands.js";

/**
 * Minimal interface that every API function needs from the surrounding client:
 *   - send a command string to OMC and await the raw response
 *   - fetch (and clear) OMC's accumulated error buffer for failed mutations
 *
 * `OmcClient` implements this interface. The functional API in `api/*` takes
 * a `CallContext` so it can be used outside the class as well — useful for
 * tree-shakable consumers and tests with mock contexts.
 */
export interface CallContext {
  call(cmd: OmcCommand): Promise<string>;
  getErrorString(): Promise<{ errorString: string }>;
}
