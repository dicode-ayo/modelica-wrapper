/**
 * A {@link WriteVerdictSource} derived from OMC and the filesystem alone, for a
 * host with no editor behind it.
 *
 * It refuses what the extension's `WriteVerdicts` refuses, in the same words:
 *
 *  - a class whose source file lies under a `MODELICAPATH` entry — a system
 *    library, read-only however its files are chmod'ed, since a
 *    package-manager install under `~/.openmodelica/libraries/` is owned by the
 *    user;
 *  - a class whose source file OMC reports as read-only.
 *
 * Every `MODELICAPATH` entry counts as a system library: a host without an
 * editor has no setting through which a user adds a directory of their own.
 *
 * Deriving a verdict fails **open**: a transient OMC error must not lock a
 * caller out of a model that is theirs to edit.
 */

import * as path from "node:path";

import { isLikelyDiskPath, splitModelicaPath } from "@dicode/omc-client";

import { errorDetail } from "./error-detail.js";
import type { McpLog } from "./log.js";
import type {
  WriteAction,
  WriteVerdict,
  WriteVerdictClient,
  WriteVerdictSource,
} from "./write-verdict.js";

interface ModelicaPathReader {
  getModelicaPath(): Promise<{ modelicaPath: string }>;
}

const WRITABLE: WriteVerdict = { ok: true };

type Blocker = "systemLibrary" | "readOnlyFile";

const PHRASE: Record<WriteAction, (className: string) => string> = {
  edit: (className) => `edit ${className}`,
  save: (className) => `save ${className}`,
  createInside: (className) => `create a class inside ${className}`,
};

const BECAUSE: Record<Blocker, string> = {
  systemLibrary: "it belongs to a read-only system library",
  readOnlyFile: "its source file is read-only",
};

function refuse(
  className: string,
  action: WriteAction,
  blocker: Blocker,
): WriteVerdict {
  return {
    ok: false,
    reason: `Cannot ${PHRASE[action](className)} — ${BECAUSE[blocker]}.`,
  };
}

/** True when `file` is `root` itself or nested beneath it. */
function isUnder(file: string, root: string): boolean {
  const rel = path.relative(root, file);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function createFsWriteVerdicts(log: McpLog): WriteVerdictSource {
  /**
   * The first `MODELICAPATH` read on a client is the one every later verdict
   * uses: a tool call may `setModelicaPath`, and narrowing the path must not
   * turn a loaded library writable. A rejected read is dropped so the next
   * verdict asks again.
   */
  const rootsByClient = new WeakMap<ModelicaPathReader, Promise<string[]>>();

  const systemLibraryRoots = (
    client: ModelicaPathReader,
  ): Promise<string[]> => {
    const cached = rootsByClient.get(client);
    if (cached !== undefined) return cached;
    const roots = client
      .getModelicaPath()
      .then(({ modelicaPath }) => splitModelicaPath(modelicaPath));
    rootsByClient.set(client, roots);
    roots.catch(() => rootsByClient.delete(client));
    return roots;
  };

  const fromSystemLibrary = async (
    client: WriteVerdictClient,
    className: string,
  ): Promise<boolean> => {
    const { fileName } = await client.getSourceFile({ typeName: className });
    if (!isLikelyDiskPath(fileName)) return false;
    const file = path.resolve(fileName);
    const roots = await systemLibraryRoots(client);
    return roots.some((root) => isUnder(file, path.resolve(root)));
  };

  return {
    forClass: async (client, className, action) => {
      try {
        if (await fromSystemLibrary(client, className)) {
          return refuse(className, action, "systemLibrary");
        }
        const { fileReadOnly } = await client.getClassInformation({
          typeName: className,
        });
        return fileReadOnly
          ? refuse(className, action, "readOnlyFile")
          : WRITABLE;
      } catch (err) {
        log.warn(
          `${className}: write verdict lookup failed, treating as writable: ${errorDetail(err)}`,
        );
        return WRITABLE;
      }
    },
    systemLibraryRoots,
  };
}
