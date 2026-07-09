/**
 * Workspace auto-load: load discovered entry files into OMC on activation, then
 * refresh the sidebar exactly once.
 */

import { log } from "./logger.js";

/** OMC surface the auto-loader calls. `OmcClient` satisfies it structurally. */
export interface AutoLoadClient {
  loadFile(input: { fileName: string }): Promise<{ success: boolean }>;
  getErrorString(): Promise<{ errorString: string }>;
}

/**
 * Load each entry file, then invoke `refresh` a single time — but only if at
 * least one file loaded. One refresh (not one per file) keeps the post-startup
 * rebuild to a single, mutex-serialized OMC fetch instead of a concurrent
 * batch; skipping it when nothing loaded lets a genuinely empty workspace keep
 * its "Load Library" state.
 */
export async function loadEntryFilesAndRefresh(
  client: AutoLoadClient,
  files: readonly string[],
  refresh: () => void,
): Promise<void> {
  let loadedAny = false;
  for (const fileName of files) {
    try {
      const { success } = await client.loadFile({ fileName });
      if (success) {
        loadedAny = true;
        log.info("autoLoad", `loaded ${fileName}`);
      } else {
        const { errorString } = await client.getErrorString();
        log.warn("autoLoad", `loadFile failed: ${fileName}: ${errorString}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("autoLoad", `loadFile threw for ${fileName}: ${message}`);
    }
  }
  if (loadedAny) {
    refresh();
  }
}
