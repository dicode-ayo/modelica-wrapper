/**
 * Reaping OMC sessions whose owner is gone.
 *
 * OMC is not killed by the death of the process that spawned it, so a host
 * that never reaches `OmcProcess.stop()` — an extension host killed from the
 * debugger, a crashed test runner — strands a compiler process and its
 * tempdir. Every spawn stamps its owner's pid into that tempdir's name, which
 * is what lets a later run tell a live session's directory from an abandoned
 * one.
 *
 * Nothing here is signalled or deleted on a guess: a session whose OMC cannot
 * be identified is left exactly as it is, because removing the directory
 * destroys the only record that the process ever existed.
 */

import { readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type ProcessProbe, osProcesses } from "./process-probe.js";
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

/**
 * What the process table says about the OMC a session directory describes.
 * `marker` is the command-line fragment the pid was identified by, which is
 * the only evidence that re-confirms the pid still holds that same process.
 */
type OmcState =
  | { readonly state: "running"; readonly pid: number; readonly marker: string }
  | { readonly state: "gone" }
  | { readonly state: "unidentified" };

async function reapSession(
  root: string,
  name: string,
  processes: ProcessProbe,
  quit: (endpoint: string) => Promise<void>,
): Promise<boolean> {
  const dir = join(root, name);
  const owner = ownerPidFromSessionDir(name);
  // A recycled owner pid reads as a live window and spares the session on
  // every sweep — the leak, back and invisible, until the pid's new holder
  // exits. An arbitrary host process offers nothing to fingerprint against,
  // so this one stays a plain pid check.
  if (owner !== undefined && processes.isRunning(owner)) return false;

  const portFile = await findPortFile(dir);
  const suffix =
    portFile === undefined ? undefined : suffixFromPortFileName(portFile);
  const omc = await identifyOmc(dir, suffix, processes);
  if (omc.state === "unidentified") return false;
  if (omc.state === "running") {
    const endpoint =
      portFile === undefined ? undefined : await readEndpoint(dir, portFile);
    await stopOmc(omc.pid, omc.marker, endpoint, processes, quit);
  }
  await rm(dir, { recursive: true, force: true });
  return true;
}

/**
 * Pids are recycled exactly as ports are, and these directories can be days
 * old, so a recorded pid counts as this session's OMC only while its command
 * line still carries the `-z=` suffix OMC was spawned with. A session that
 * recorded no pid — one predating the scheme, or one whose host died between
 * the spawn and the write — is looked up by that same suffix instead.
 */
async function identifyOmc(
  dir: string,
  suffix: string | undefined,
  processes: ProcessProbe,
): Promise<OmcState> {
  const recorded = await readOmcPid(dir);
  if (recorded !== undefined) {
    if (!processes.isRunning(recorded)) return { state: "gone" };
    const cmd = processes.commandLine(recorded);
    if (cmd === undefined) return { state: "unidentified" };
    if (suffix === undefined) {
      // Nothing to match against: an OMC under this pid may well be ours.
      return cmd.includes("--interactive=zmq")
        ? { state: "unidentified" }
        : { state: "gone" };
    }
    const marker = `-z=${suffix}`;
    return cmd.includes(marker)
      ? { state: "running", pid: recorded, marker }
      : { state: "gone" };
  }

  if (suffix === undefined) return { state: "unidentified" };
  const marker = `-z=${suffix}`;
  const matches = processes.findByCommandLine(marker);
  if (matches === undefined) return { state: "unidentified" };
  if (matches.length === 0) return { state: "gone" };
  // A command line can carry the suffix without being OMC at all — a grep, a
  // shell history. Without an owner pid to check, being reparented is the only
  // evidence that no live window is still using the OMC among them.
  const pid = matches.find(
    (match) =>
      processes.isOrphan(match) &&
      processes.commandLine(match)?.includes("--interactive=zmq") === true,
  );
  return pid === undefined
    ? { state: "unidentified" }
    : { state: "running", pid, marker };
}

async function stopOmc(
  pid: number,
  marker: string,
  endpoint: string | undefined,
  processes: ProcessProbe,
  quit: (endpoint: string) => Promise<void>,
): Promise<void> {
  if (endpoint !== undefined) {
    try {
      await quit(endpoint);
      await awaitExit(processes, pid);
    } catch {
      /* mute peer — the kill below is the fallback */
    }
  }
  // The quit above, and the polling around it, give the pid time to be
  // recycled onto something else — so what authorizes the signal is that the
  // pid still carries the command line it was identified by, not that it is
  // merely occupied.
  if (!processes.confirmIdentity(pid, marker)) return;
  processes.kill(pid);
  // OMC still holds this directory as its TMPDIR; removing it out from under a
  // process that has not finished exiting fails outright on Windows.
  await awaitExit(processes, pid);
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

async function quitViaZmq(endpoint: string): Promise<void> {
  const transport = new OmcTransport(endpoint);
  await transport.dial();
  try {
    await transport.send("quit()", QUIT_TIMEOUT_MS);
  } finally {
    await transport.close();
  }
}
