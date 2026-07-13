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
  const tryLoad = async (fileName: string): Promise<boolean> => {
    try {
      const { success } = await client.loadFile({ fileName });
      if (success) {
        log.info("autoLoad", `loaded ${fileName}`);
        return true;
      }
      const { errorString } = await client.getErrorString();
      log.warn("autoLoad", `loadFile failed: ${fileName}: ${errorString}`);
      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("autoLoad", `loadFile threw for ${fileName}: ${message}`);
      return false;
    }
  };

  let loadedAny = false;
  let failed: string[] = [];
  for (const fileName of files) {
    if (await tryLoad(fileName)) loadedAny = true;
    else failed.push(fileName);
  }
  // A `within <Parent>;` child in a standalone file fails to insert when its
  // parent package file hasn't loaded yet (discovery order is arbitrary — a
  // child can sort before its parent). Retry the still-failed set pass by pass
  // as long as each pass loads at least one; a pass that loads a parent unblocks
  // its children, which unblocks grandchildren, until no pass makes progress.
  while (failed.length > 0 && loadedAny) {
    const stillFailed: string[] = [];
    let progressed = false;
    for (const fileName of failed) {
      if (await tryLoad(fileName)) progressed = true;
      else stillFailed.push(fileName);
    }
    failed = stillFailed;
    if (!progressed) break;
  }
  if (loadedAny) {
    refresh();
  }
}
