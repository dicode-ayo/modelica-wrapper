/**
 * OMC subprocess management.
 *
 * Spawns `omc --interactive=zmq -z=<suffix>` and waits for OMC to drop its
 * port file at `${tmpdir}/openmodelica.${user}.port.${suffix}`. The file
 * contents are the ZMQ endpoint, e.g. `tcp://127.0.0.1:33421`.
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
  const portFile = portFilePath(suffix);

  // Paranoid: clean any pre-existing file at this path. Suffix is random.
  try {
    await unlink(portFile);
  } catch {
    /* not present — fine */
  }

  const child: ChildProcess = spawn(bin, ["--interactive=zmq", `-z=${suffix}`], {
    stdio: ["ignore", "ignore", "inherit"],
  });

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
    try {
      await unlink(portFile);
    } catch {
      /* gone already — fine */
    }
  };

  try {
    const endpoint = await Promise.race([
      waitForPortFile(portFile, PORT_FILE_TIMEOUT_MS, signal),
      errorPromise,
    ]);
    return { endpoint, stop };
  } catch (err) {
    await stop();
    throw err;
  }
}

/** OS-specific path where omc writes the port file when launched with -z=<suffix>. */
function portFilePath(suffix: string): string {
  const tmp = tmpdir();
  if (process.platform === "win32") {
    return join(tmp, `openmodelica.port.${suffix}`);
  }
  let user = userInfo().username;
  // Strip any DOMAIN\ prefix on edge-case Unix setups.
  const slash = user.lastIndexOf("\\");
  if (slash >= 0) user = user.slice(slash + 1);
  return join(tmp, `openmodelica.${user}.port.${suffix}`);
}

async function waitForPortFile(
  path: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (signal?.aborted) throw new Error("aborted");
    try {
      const data = await readFile(path, "utf8");
      const endpoint = data.trim();
      if (endpoint.length > 0) return endpoint;
    } catch {
      /* not yet — keep polling */
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for omc port file ${path}`);
    }
    await sleep(50);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
