/**
 * Reaping OMC sessions whose owner is gone.
 *
 * OMC is not killed by the death of the process that spawned it, so a host
 * that never reaches `OmcProcess.stop()` — an extension host killed from the
 * debugger, a crashed test runner — strands a compiler process and its
 * tempdir. Every spawn records its owner's pid in that tempdir, which is what
 * lets a later run tell a live session's directory from an abandoned one.
 */

import { readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OmcTransport } from "./transport.js";

/** Prefix of the per-spawn tempdir handed to OMC as its `TMPDIR`. */
export const SESSION_DIR_PREFIX = "mw-omc-";

/** Pid of the process that spawned OMC, written inside the session tempdir. */
export const OWNER_PID_FILE = "owner.pid";

/** Pid of the OMC process itself, written inside its session tempdir. */
export const OMC_PID_FILE = "omc.pid";

const QUIT_TIMEOUT_MS = 2_000;

/**
 * A session directory is created before its owner pid is written; without a
 * grace period that window would read as "abandoned" to a concurrent reap.
 */
const NEW_SESSION_GRACE_MS = 10_000;

export interface ProcessProbe {
  isRunning(pid: number): boolean;
  kill(pid: number): void;
}

export interface ReapOptions {
  /** Directory holding the session tempdirs. Defaults to the OS tempdir. */
  root?: string;
  /** Access to the OS process table. */
  processes?: ProcessProbe;
  /** Ask the OMC listening on `endpoint` to shut itself down. */
  quit?: (endpoint: string) => Promise<void>;
}

/**
 * Shut down every stranded OMC found under the session root and remove its
 * tempdir. Best-effort: a session that no longer answers is still cleaned up.
 *
 * @returns how many session directories were removed.
 */
export async function reapOrphanedOmcSessions(
  options: ReapOptions = {},
): Promise<number> {
  const root = options.root ?? tmpdir();
  const processes = options.processes ?? osProcesses;
  const quit = options.quit ?? quitViaZmq;

  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return 0;
  }

  const reaped = await Promise.all(
    entries
      .filter((name) => name.startsWith(SESSION_DIR_PREFIX))
      .map((name) => reapSession(join(root, name), processes, quit)),
  );
  return reaped.filter(Boolean).length;
}

async function reapSession(
  dir: string,
  processes: ProcessProbe,
  quit: (endpoint: string) => Promise<void>,
): Promise<boolean> {
  const owner = await readPid(dir, OWNER_PID_FILE);
  if (owner !== undefined && processes.isRunning(owner)) return false;
  if (owner === undefined && (await isRecent(dir))) return false;

  // Ports outlive the processes that held them, so an endpoint alone is no
  // proof of identity — a session whose OMC is already gone gets no traffic.
  const omcPid = await readPid(dir, OMC_PID_FILE);
  if (omcPid !== undefined && processes.isRunning(omcPid)) {
    const endpoint = await readEndpoint(dir);
    if (endpoint !== undefined) {
      try {
        await quit(endpoint);
      } catch {
        /* mute peer — the kill below is the fallback */
      }
    }
    if (processes.isRunning(omcPid)) processes.kill(omcPid);
  }
  await rm(dir, { recursive: true, force: true });
  return true;
}

async function readPid(dir: string, file: string): Promise<number | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(dir, file), "utf8");
  } catch {
    return undefined;
  }
  const pid = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/** The endpoint OMC published, read back from the port file it dropped. */
async function readEndpoint(dir: string): Promise<string | undefined> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return undefined;
  }
  const portFile = names.find(
    (name) => name.startsWith("openmodelica.") && name.includes(".port."),
  );
  if (portFile === undefined) return undefined;
  try {
    const endpoint = (await readFile(join(dir, portFile), "utf8")).trim();
    return endpoint.length > 0 ? endpoint : undefined;
  } catch {
    return undefined;
  }
}

async function isRecent(dir: string): Promise<boolean> {
  try {
    const { mtimeMs } = await stat(dir);
    return Date.now() - mtimeMs < NEW_SESSION_GRACE_MS;
  } catch {
    return true;
  }
}

const osProcesses: ProcessProbe = {
  isRunning(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      // EPERM means the pid is taken by a process we may not signal — alive.
      return (err as NodeJS.ErrnoException).code === "EPERM";
    }
  },
  kill(pid) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* it exited between the check and the signal */
    }
  },
};

async function quitViaZmq(endpoint: string): Promise<void> {
  const transport = new OmcTransport(endpoint);
  await transport.dial();
  try {
    await transport.send("quit()", QUIT_TIMEOUT_MS);
  } finally {
    await transport.close();
  }
}
