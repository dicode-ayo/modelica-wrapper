/**
 * OMC subprocess management.
 *
 * Spawns `omc --interactive=zmq -z=<suffix>` and waits for OMC to drop its
 * port file. Giving OMC its own per-spawn tempdir and a fixed sentinel `USER`
 * via the spawn env puts that file where `./session.ts` says it will be. No
 * probing, no platform-specific path drift, no username surprises.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  OMC_PID_FILE,
  WRAPPER_USER,
  portFileName,
  sessionDirPrefix,
} from "./session.js";

const PORT_FILE_TIMEOUT_MS = 30_000;

export interface OmcProcess {
  /** ZMQ endpoint, e.g. tcp://127.0.0.1:33421. */
  readonly endpoint: string;
  /** Stop OMC and remove its tempdir. Idempotent. */
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
  const tempDir = await mkdtemp(join(tmpdir(), sessionDirPrefix(process.pid)));
  const portFile = join(tempDir, portFileName(suffix));

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (process.platform === "win32") {
    // GetTempPath() consults TMP, then TEMP, then USERPROFILE.
    env.TMP = tempDir;
    env.TEMP = tempDir;
  } else {
    env.TMPDIR = tempDir;
    env.USER = WRAPPER_USER;
  }

  const debug = process.env.OMC_DEBUG === "1";
  const child: ChildProcess = spawn(
    bin,
    ["--interactive=zmq", `-z=${suffix}`],
    {
      env,
      stdio: ["ignore", debug ? "pipe" : "ignore", debug ? "pipe" : "inherit"],
    },
  );

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

  killWhenThisProcessExits(child);
  if (child.pid !== undefined) {
    await writeFile(join(tempDir, OMC_PID_FILE), `${child.pid}`, "utf8");
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
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }
        child.once("exit", () => resolve());
      });
    }
    await rm(tempDir, { recursive: true, force: true });
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

const liveChildren = new Set<ChildProcess>();
let exitHookInstalled = false;

/**
 * OMC survives its parent, so an exit that skips `stop()` would strand it.
 * Covers a crash or an explicit `process.exit`; a host killed outright runs no
 * hook at all and is caught by {@link reapOrphanedOmcSessions} on the next run.
 */
function killWhenThisProcessExits(child: ChildProcess): void {
  liveChildren.add(child);
  child.once("exit", () => liveChildren.delete(child));
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    for (const c of liveChildren) c.kill("SIGKILL");
  });
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
