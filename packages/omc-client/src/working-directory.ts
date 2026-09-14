/**
 * Where OMC drops what a simulation builds.
 *
 * `simulate` writes the C sources, object files, the compiled executable and
 * the `.mat` result into OMC's working directory, which OMC takes from the
 * process that spawned it and which no `simulate` argument overrides. Left
 * alone that is wherever the host happened to start, so a single run scatters
 * dozens of files over it.
 *
 * Parking the session in one directory under the source tree is what keeps the
 * result findable and the tree clean with one `.gitignore` entry. Every host
 * does it the same way, so an assistant driving the MCP tools and a user
 * pressing Simulate in the editor read their results back from one place.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/** Working directory under the source tree root, created if absent. */
export const WORKSPACE_CACHE_DIRNAME = ".modelica";

/** The OMC surface parking needs. `OmcClient` satisfies it. */
export interface WorkingDirectoryClient {
  cd(input: { newWorkingDirectory: string }): Promise<{
    workingDirectory: string;
  }>;
}

/**
 * Points `client` at `<root>/.modelica`, and answers where OMC says it landed
 * — which is normalized, so it is the value to report rather than the path
 * passed in.
 *
 * Throws when the directory cannot be created or entered. Parking is a
 * tidiness measure rather than a correctness one, so a host is expected to log
 * that and keep the session: OMC with an untidy working directory still runs
 * every model. The directory is created before the `cd` because OMC reports a
 * bad path in-band rather than failing the call.
 */
export async function parkWorkingDirectory(
  client: WorkingDirectoryClient,
  root: string,
): Promise<string> {
  const directory = join(root, WORKSPACE_CACHE_DIRNAME);
  await mkdir(directory, { recursive: true });
  const { workingDirectory } = await client.cd({
    newWorkingDirectory: directory,
  });
  return workingDirectory;
}
