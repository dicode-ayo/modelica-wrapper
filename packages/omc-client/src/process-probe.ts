/**
 * The reaper's window onto the OS process table.
 *
 * Every method answers "cannot tell" as `undefined` rather than guessing, so
 * a platform without procfs and without `ps` degrades to leaving sessions
 * alone instead of signalling processes it has not identified.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

export interface ProcessProbe {
  isRunning(pid: number): boolean;
  /** The process's command line, or `undefined` where it cannot be read. */
  commandLine(pid: number): string | undefined;
  /**
   * Pids whose command line contains `fragment`, empty when none does.
   * `undefined` where the process table cannot be enumerated.
   */
  findByCommandLine(fragment: string): number[] | undefined;
  /**
   * Whether the process has outlived whatever spawned it. Adoption by init is
   * the signal; under a subreaper (`systemd --user`, a container supervisor)
   * an orphan keeps a live parent and reads as `false`, which degrades to
   * sparing a session — never to signalling one.
   */
  isOrphan(pid: number): boolean;
  kill(pid: number): void;
}

export const osProcesses: ProcessProbe = {
  isRunning,
  commandLine(pid) {
    return procfsCommandLine(pid) ?? psCommandLine(pid);
  },
  findByCommandLine(fragment) {
    return procfsScan(fragment) ?? psScan(fragment);
  },
  isOrphan(pid) {
    const parent = parentPid(pid);
    if (parent === undefined) return false;
    return parent <= 1 || !isRunning(parent);
  },
  kill(pid) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* it exited between the check and the signal */
    }
  },
};

/**
 * The parent pid in a `/proc/<pid>/stat` line. The fixed fields start after
 * the executable name, which is parenthesised and may itself contain spaces
 * and parentheses — so the last `)`, not the first, ends it.
 */
export function ppidFromStat(stat: string): number | undefined {
  const comm = stat.lastIndexOf(")");
  if (comm < 0) return undefined;
  const fields = stat
    .slice(comm + 1)
    .trim()
    .split(/\s+/);
  const ppid = Number.parseInt(fields[1] ?? "", 10);
  return Number.isInteger(ppid) ? ppid : undefined;
}

/** Rows of `ps -o pid=,command=` output, skipping anything unparseable. */
export function parsePsTable(out: string): { pid: number; command: string }[] {
  const rows: { pid: number; command: string }[] = [];
  for (const line of out.split("\n")) {
    const fields = /^\s*(\d+)\s+(\S.*)$/.exec(line);
    const rawPid = fields?.[1];
    const command = fields?.[2];
    if (rawPid === undefined || command === undefined) continue;
    const pid = Number.parseInt(rawPid, 10);
    if (pid > 0) rows.push({ pid, command });
  }
  return rows;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the pid is taken by a process we may not signal — alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function procfsCommandLine(pid: number): string | undefined {
  const raw = readProc(`/proc/${pid}/cmdline`);
  if (raw === undefined) return undefined;
  const cmd = raw.replaceAll("\0", " ").trim();
  return cmd.length > 0 ? cmd : undefined;
}

function psCommandLine(pid: number): string | undefined {
  const out = ps(["-ww", "-p", String(pid), "-o", "command="])?.trim();
  return out === undefined || out.length === 0 ? undefined : out;
}

function procfsScan(fragment: string): number[] | undefined {
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return undefined;
  }
  const found: number[] = [];
  for (const entry of entries) {
    const pid = Number.parseInt(entry, 10);
    if (!Number.isInteger(pid) || String(pid) !== entry) continue;
    if (procfsCommandLine(pid)?.includes(fragment) === true) found.push(pid);
  }
  return found;
}

function psScan(fragment: string): number[] | undefined {
  const out = ps(["axww", "-o", "pid=,command="]);
  if (out === undefined) return undefined;
  return parsePsTable(out)
    .filter((row) => row.command.includes(fragment))
    .map((row) => row.pid);
}

function parentPid(pid: number): number | undefined {
  const stat = readProc(`/proc/${pid}/stat`);
  if (stat !== undefined) {
    const ppid = ppidFromStat(stat);
    if (ppid !== undefined) return ppid;
  }
  const out = ps(["-p", String(pid), "-o", "ppid="]);
  if (out === undefined) return undefined;
  const ppid = Number.parseInt(out.trim(), 10);
  return Number.isInteger(ppid) ? ppid : undefined;
}

function readProc(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function ps(args: string[]): string | undefined {
  try {
    return execFileSync("ps", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}
