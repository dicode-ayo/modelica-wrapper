import { parkWorkingDirectory } from "@dicode/omc-client";

import type { McpToolDeps } from "./dispatch.js";
import { errorDetail } from "./error-detail.js";
import type { McpLog } from "./log.js";

/**
 * `deps` whose OMC is parked in the source tree's working directory before any
 * tool reaches it, so a simulation an assistant runs leaves its artifacts where
 * one run by hand does.
 *
 * A host that owns OMC may have parked it already — the editor parks at session
 * creation — and `cd` to a directory OMC is already in costs one round-trip and
 * changes nothing, so this repeats that rather than coordinating with it. Each
 * client is parked once; `ensureClient` hands out a new one after a session
 * reset, and that one is parked too.
 *
 * A host with no source tree has nowhere to park, and OMC keeps the working
 * directory it started with.
 */
export function parked(deps: McpToolDeps, log: McpLog): McpToolDeps {
  const done = new WeakSet<object>();
  return {
    ...deps,
    // Every dispatched call logs through the same channel the host's own
    // lifecycle messages (cwd parking, transport failures) already use, unless
    // the caller wired something more specific.
    log: deps.log ?? log,
    ensureClient: async () => {
      const client = await deps.ensureClient();
      const { workspace } = deps;
      if (workspace === undefined || done.has(client)) return client;
      done.add(client);
      try {
        const directory = await parkWorkingDirectory(client, workspace.root);
        log.info(`OMC cwd → ${directory}`);
      } catch (err) {
        log.warn(`parking OMC's cwd failed: ${errorDetail(err)}`);
      }
      return client;
    },
  };
}
