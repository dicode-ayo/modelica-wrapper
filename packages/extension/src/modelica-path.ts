/**
 * Applies the `modelica.modelicaPath` setting to an OMC session.
 *
 * OMC's library path cannot be extended, only replaced, and of the entries
 * holding the same library the **last** one wins. So the installed default is
 * read first and kept at the end: a user entry can add a library but cannot
 * shadow the Modelica Standard Library. Entries are joined with
 * `path.delimiter` because OMC splits on the platform's separator alone — a
 * `;` on Linux is read as part of one directory name.
 *
 * The read goes through {@link systemLibraryRoots}, so the default it captures
 * is also what the session's write verdicts judge against: a class loaded from
 * a user entry stays editable.
 */

import * as path from "node:path";

import { errorDetail } from "./error-detail.js";
import { log } from "./logger.js";
import {
  systemLibraryRoots,
  type ModelicaPathReader,
} from "./system-library.js";

export interface ModelicaPathClient extends ModelicaPathReader {
  setModelicaPath(input: {
    modelicaPath: string;
  }): Promise<{ success: boolean }>;
}

/**
 * The setting as one workspace folder sees it. `folder` is `undefined` in a
 * window with no folder open, where a relative entry has nothing to resolve
 * against.
 */
export interface ModelicaPathScope {
  readonly folder: string | undefined;
  readonly entries: readonly string[];
}

/**
 * Every scope's entries as absolute directories, in folder order, each named
 * once. A user-level relative entry is seen by every folder, so it contributes
 * one directory per folder.
 */
export function resolveModelicaPathEntries(
  scopes: readonly ModelicaPathScope[],
): string[] {
  const resolved: string[] = [];
  for (const { folder, entries } of scopes) {
    for (const raw of entries) {
      const entry = raw.trim();
      if (entry === "") continue;
      if (path.isAbsolute(entry)) {
        resolved.push(path.normalize(entry));
      } else if (folder !== undefined) {
        resolved.push(path.resolve(folder, entry));
      } else {
        log.warn(
          "modelicaPath",
          `skipping relative entry "${entry}": no workspace folder is open`,
        );
      }
    }
  }
  return [...new Set(resolved)];
}

/**
 * Point `client`'s library path at the user's entries followed by the
 * installed default. Never throws: a session left on its inherited path still
 * works, so a failure is logged and the spawn carries on.
 *
 * The default is captured even when there is nothing to add, so a later
 * `setModelicaPath` typed into the REPL cannot redefine what counts as a
 * system library either.
 */
export async function applyModelicaPath(
  client: ModelicaPathClient,
  scopes: readonly ModelicaPathScope[],
): Promise<void> {
  try {
    const installed = await systemLibraryRoots(client);
    const user = resolveModelicaPathEntries(scopes);
    if (user.length === 0) return;
    const modelicaPath = [...user, ...installed].join(path.delimiter);
    const { success } = await client.setModelicaPath({ modelicaPath });
    if (!success) {
      log.warn("modelicaPath", `OMC rejected the library path ${modelicaPath}`);
      return;
    }
    log.info("modelicaPath", `library path → ${modelicaPath}`);
  } catch (err) {
    log.warn(
      "modelicaPath",
      `applying modelica.modelicaPath failed: ${errorDetail(err)}`,
    );
  }
}
