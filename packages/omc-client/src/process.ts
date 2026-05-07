/**
 * OMC subprocess management.
 *
 * Spawns `omc --interactive=zmq -z=<suffix>` and waits for OMC to drop its
 * port file. The default location is `${tmpdir}/openmodelica.${user}.port.${suffix}`,
 * but root-uid OMC builds drop the user segment (so e.g. CI containers running
 * as root use `${tmpdir}/openmodelica.port.${suffix}`). The file contents are
 * the ZMQ endpoint, e.g. `tcp://127.0.0.1:33421`.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

const PORT_FILE_TIMEOUT_MS = 30_000;

export interface OmcProcess {
  /** ZMQ endpoint, e.g. tcp://127.0.0.1:33421. */
  readonly endpoint: string;
  /** Stop OMC and remove its port file. Idempotent. */
  stop(): Promise<void>;
}

/**
 * Spawn an OMC interactive ZMQ subprocess and wait for its port file to appear.
 *
 * @param omcPath path to omc binary; pass "" or "omc" to use PATH lookup.
 * @param signal optional AbortSignal to cancel the wait.
 */
export async function spawnOmc(
  omcPath: string,
  signal?: AbortSignal,
): Promise<OmcProcess> {
  const bin = omcPath && omcPath.length > 0 ? omcPath : "omc";
  const suffix = `mw_${randomBytes(8).toString("hex")}`;
  const candidates = portFilePaths(suffix);

  // Paranoid: clean any pre-existing file at these paths. Suffix is random.
  for (const p of candidates) {
    try {
      await unlink(p);
    } catch {
      /* not present — fine */
    }
  }

  const debug = process.env.OMC_DEBUG === "1";
  const child: ChildProcess = spawn(bin, ["--interactive=zmq", `-z=${suffix}`], {
    stdio: ["ignore", debug ? "pipe" : "ignore", debug ? "pipe" : "inherit"],
  });

  if (debug) {
    // Vitest captures stderr verbatim into CI logs; route both streams there
    // (prefixed) so test stdout is not conflated with OMC chatter.
    child.stdout?.on("data", (chunk: Buffer | string) => {
      process.stderr.write(`[omc] ${chunk}`);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      process.stderr.write(`[omc] ${chunk}`);
    });
  }

  // Surface spawn failures (ENOENT for missing binary etc.) as rejection.
  const errorPromise = new Promise<never>((_, reject) => {
    child.once("error", reject);
  });

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (child.pid !== undefined && child.exitCode === null) {
      child.kill("SIGKILL");
      // Best effort wait for exit.
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }
        child.once("exit", () => resolve());
      });
    }
    for (const p of candidates) {
      try {
        await unlink(p);
      } catch {
        /* gone already — fine */
      }
    }
  };

  try {
    const endpoint = await Promise.race([
      waitForPortFile(candidates, PORT_FILE_TIMEOUT_MS, signal),
      errorPromise,
    ]);
    return { endpoint, stop };
  } catch (err) {
    await stop();
    throw err;
  }
}

/**
 * OS-specific candidate paths where omc may write the port file when launched
 * with `-z=<suffix>`. Order matters: most likely first.
 *
 * Exported for testability; not part of the public package surface.
 */
export function portFilePaths(suffix: string): string[] {
  const tmp = tmpdir();
  if (process.platform === "win32") {
    return [join(tmp, `openmodelica.port.${suffix}`)];
  }
  const info = userInfo();
  let user = info.username;
  // Strip any DOMAIN\ prefix on edge-case Unix setups.
  const slash = user.lastIndexOf("\\");
  if (slash >= 0) user = user.slice(slash + 1);

  const userPrefixed = join(tmp, `openmodelica.${user}.port.${suffix}`);
  // Root-uid OMC builds drop the user segment from the port-file name.
  const isRoot = info.uid === 0 || user === "root";
  if (isRoot) {
    const unprefixed = join(tmp, `openmodelica.port.${suffix}`);
    return [unprefixed, userPrefixed];
  }
  return [userPrefixed];
}

async function waitForPortFile(
  paths: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (signal?.aborted) throw new Error("aborted");
    for (const path of paths) {
      try {
        const data = await readFile(path, "utf8");
        const endpoint = data.trim();
        if (endpoint.length > 0) return endpoint;
      } catch {
        /* not yet — keep polling */
      }
    }
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for omc port file (probed: ${paths.join(", ")})`,
      );
    }
    await sleep(50);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
