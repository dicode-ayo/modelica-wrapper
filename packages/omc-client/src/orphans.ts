/**
 * Reaping OMC sessions whose owner is gone.
 *
 * OMC is not killed by the death of the process that spawned it, so a host
 * that never reaches `OmcProcess.stop()` — an extension host killed from the
 * debugger, a crashed test runner — strands a compiler process and its
 * tempdir. Every spawn stamps its owner's pid into that tempdir's name, which
 * is what lets a later run tell a live session's directory from an abandoned
 * one.
 */

import { readFileSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  OMC_PID_FILE,
  SESSION_DIR_PREFIX,
  isPortFileName,
  ownerPidFromSessionDir,
  suffixFromPortFileName,
} from "./session.js";
import { OmcTransport } from "./transport.js";

const QUIT_TIMEOUT_MS = 2_000;

/** How long a shutdown gets before the directory is pulled out from under it. */
const EXIT_WAIT_MS = 1_000;
const EXIT_POLL_MS = 25;

export interface ProcessProbe {
  isRunning(pid: number): boolean;
  /** The process's command line, or `undefined` where it cannot be read. */
  commandLine(pid: number): string | undefined;
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
 * tempdir. Best-effort: a session that no longer answers is still cleaned up,
 * and a session that cannot be cleaned up does not hold back the others.
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

  const reaped = await Promise.allSettled(
    entries
      .filter((name) => name.startsWith(SESSION_DIR_PREFIX))
      .map((name) => reapSession(root, name, processes, quit)),
  );
  return reaped.filter((r) => r.status === "fulfilled" && r.value).length;
}

async function reapSession(
  root: string,
  name: string,
  processes: ProcessProbe,
  quit: (endpoint: string) => Promise<void>,
): Promise<boolean> {
  const dir = join(root, name);
  const owner = ownerPidFromSessionDir(name);
  // A directory with no pid in its name predates this scheme. Its OMC cannot
  // be identified, and removing the directory would destroy the only record
  // that the process ever existed.
  if (owner === undefined) return false;
  // A recycled owner pid reads as a live window and spares the session on
  // every sweep — the leak, back and invisible, until the pid's new holder
  // exits. An arbitrary host process offers nothing to fingerprint against,
  // so this one stays a plain pid check.
  if (processes.isRunning(owner)) return false;

  const portFile = await findPortFile(dir);
  await stopOmc(dir, portFile, processes, quit);
  await rm(dir, { recursive: true, force: true });
  return true;
}

async function stopOmc(
  dir: string,
  portFile: string | undefined,
  processes: ProcessProbe,
  quit: (endpoint: string) => Promise<void>,
): Promise<void> {
  const pid = await readOmcPid(dir);
  if (pid === undefined || !processes.isRunning(pid)) return;
  // Pids are recycled exactly as ports are, and these directories are days
  // old: without matching OMC's own `-z=` suffix, the signal below could land
  // on whatever inherited the number.
  if (!isOurOmc(processes.commandLine(pid), portFile)) return;

  const endpoint =
    portFile === undefined ? undefined : await readEndpoint(dir, portFile);
  if (endpoint !== undefined) {
    try {
      await quit(endpoint);
      await awaitExit(processes, pid);
    } catch {
      /* mute peer — the kill below is the fallback */
    }
  }
  if (!processes.isRunning(pid)) return;
  processes.kill(pid);
  // OMC still holds this directory as its TMPDIR; removing it out from under a
  // process that has not finished exiting fails outright on Windows.
  await awaitExit(processes, pid);
}

function isOurOmc(
  commandLine: string | undefined,
  portFile: string | undefined,
): boolean {
  if (commandLine === undefined) return true;
  const suffix =
    portFile === undefined ? undefined : suffixFromPortFileName(portFile);
  return suffix === undefined
    ? commandLine.includes("omc")
    : commandLine.includes(`-z=${suffix}`);
}

async function awaitExit(processes: ProcessProbe, pid: number): Promise<void> {
  const deadline = Date.now() + EXIT_WAIT_MS;
  while (processes.isRunning(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, EXIT_POLL_MS));
  }
}

async function readOmcPid(dir: string): Promise<number | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(dir, OMC_PID_FILE), "utf8");
  } catch {
    return undefined;
  }
  const pid = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

async function findPortFile(dir: string): Promise<string | undefined> {
  try {
    return (await readdir(dir)).find(isPortFileName);
  } catch {
    return undefined;
  }
}

/** The endpoint OMC published, read back from the port file it dropped. */
async function readEndpoint(
  dir: string,
  portFile: string,
): Promise<string | undefined> {
  try {
    const endpoint = (await readFile(join(dir, portFile), "utf8")).trim();
    return endpoint.length > 0 ? endpoint : undefined;
  } catch {
    return undefined;
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
  commandLine(pid) {
    try {
      return readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
    } catch {
      return undefined;
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
