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

import * as os from "node:os";
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
 * one directory per folder. A leading `~` is the home directory, as a shell
 * would read it; OMC itself never expands one.
 */
export function resolveModelicaPathEntries(
  scopes: readonly ModelicaPathScope[],
): string[] {
  const resolved: string[] = [];
  for (const { folder, entries } of scopes) {
    for (const raw of entries) {
      const entry = expandHome(raw.trim());
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

function expandHome(entry: string): string {
  if (entry === "~") return os.homedir();
  if (entry.startsWith("~/") || entry.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), entry.slice(2));
  }
  return entry;
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
export function applyModelicaPath(
  client: ModelicaPathClient,
  scopes: readonly ModelicaPathScope[],
): Promise<void> {
  return writeModelicaPath(client, scopes, { whenEmpty: "keep" });
}

/**
 * Re-point the session at the setting's current entries when `event` touches
 * `modelica.modelicaPath`. `liveClient` is the running session or one still
 * spawning; with neither there is nothing to re-point, and the next spawn
 * reads the setting itself. A spawn may have read the setting before this
 * edit, so `scopes` is read only once it settles. A spawn that fails leaves
 * no session to update. Unlike {@link applyModelicaPath}, an empty setting
 * still writes the path, back to the installed default.
 */
export async function onModelicaPathChanged(
  event: { affectsConfiguration(section: string): boolean },
  liveClient: Promise<ModelicaPathClient> | undefined,
  scopes: () => readonly ModelicaPathScope[],
): Promise<void> {
  if (!event.affectsConfiguration("modelica.modelicaPath")) return;
  if (liveClient === undefined) return;
  let client: ModelicaPathClient;
  try {
    client = await liveClient;
  } catch {
    return;
  }
  await writeModelicaPath(client, scopes(), { whenEmpty: "reset" });
}

async function writeModelicaPath(
  client: ModelicaPathClient,
  scopes: readonly ModelicaPathScope[],
  { whenEmpty }: { whenEmpty: "keep" | "reset" },
): Promise<void> {
  try {
    const installed = await systemLibraryRoots(client);
    const user = resolveModelicaPathEntries(scopes);
    if (user.length === 0 && whenEmpty === "keep") return;
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
