/**
 * Workspace auto-load: load discovered entry files into OMC on activation, then
 * refresh the sidebar exactly once.
 */

import { log } from "./logger.js";
import {
  multipleTopLevelClasses,
  type FileParseClient,
} from "./single-entity-file.js";

/** OMC surface the auto-loader calls. `OmcClient` satisfies it structurally. */
export interface AutoLoadClient extends FileParseClient {
  loadFile(input: { fileName: string }): Promise<{ success: boolean }>;
  getErrorString(): Promise<{ errorString: string }>;
}

/** An entry file left unloaded because it holds more than one entity. */
export interface SkippedEntryFile {
  fileName: string;
  classNames: string[];
}

/**
 * Load each entry file, then invoke `refresh` a single time — but only if at
 * least one file loaded. One refresh (not one per file) keeps the post-startup
 * rebuild to a single, mutex-serialized OMC fetch instead of a concurrent
 * batch; skipping it when nothing loaded lets a genuinely empty workspace keep
 * its "Load Library" state.
 *
 * Returns the entry files refused for declaring several top-level classes, so
 * the caller can report the whole batch in one message.
 */
export async function loadEntryFilesAndRefresh(
  client: AutoLoadClient,
  files: readonly string[],
  refresh: () => void,
): Promise<SkippedEntryFile[]> {
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

  // Screen before the first pass, so a refused file stays out of the retry
  // loop below as well.
  const skipped: SkippedEntryFile[] = [];
  const eligible: string[] = [];
  for (const fileName of files) {
    const classNames = await multipleTopLevelClasses(client, fileName);
    if (classNames) {
      log.warn(
        "autoLoad",
        `skipping ${fileName}: declares ${classNames.join(", ")}`,
      );
      skipped.push({ fileName, classNames });
    } else {
      eligible.push(fileName);
    }
  }
  // The screen lets a file OMC could not parse through to the load, but
  // `parseFile` has already deposited that parse error; without a drain the
  // first failing load's `getErrorString` reports it as its own reason.
  await client.getErrorString();

  let loadedAny = false;
  let failed: string[] = [];
  for (const fileName of eligible) {
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
  return skipped;
}
