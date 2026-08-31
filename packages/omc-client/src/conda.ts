/**
 * Conda environment activation for the OMC subprocess.
 *
 * An `omc` built inside a conda environment has that environment's compiler
 * name (`x86_64-conda-linux-gnu-cc`) baked in and invokes it by name when it
 * compiles a simulation. Everything else — parsing, browsing, diagrams —
 * works without the environment, so the omission surfaces only on the user's
 * first simulate, as a missing compiler.
 *
 * A `conda-meta` directory beside `bin` is what marks a prefix as a conda
 * environment; conda's own activation reads the same signal.
 */

import { stat } from "node:fs/promises";
import * as path from "node:path";

/** Does a directory exist? Injectable so tests answer from a fixed set. */
export type DirectoryProbe = (absolutePath: string) => Promise<boolean>;

export const nodeDirectoryProbe: DirectoryProbe = async (absolutePath) => {
  try {
    return (await stat(absolutePath)).isDirectory();
  } catch {
    return false;
  }
};

const CONDA_MARKER = "conda-meta";

/**
 * A copy of `baseEnv` with the conda environment owning `binaryPath`
 * activated — its `bin` prepended to `PATH` — or an unchanged copy when the
 * binary sits outside one.
 *
 * A bare binary name carries no location and is left alone: it can only have
 * come from `PATH`, so the directory holding it is on `PATH` already.
 */
export async function condaActivatedEnv(
  binaryPath: string,
  baseEnv: NodeJS.ProcessEnv,
  probe: DirectoryProbe,
): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  const binDir = path.dirname(binaryPath);
  if (binDir === ".") return env;

  const prefix = path.dirname(binDir);
  if (!(await probe(path.join(prefix, CONDA_MARKER)))) return env;

  // An empty PATH entry means the working directory; prepending to "" would
  // hand the child one.
  const existing = env.PATH ?? "";
  env.PATH =
    existing.length > 0 ? `${binDir}${path.delimiter}${existing}` : binDir;
  return env;
}
