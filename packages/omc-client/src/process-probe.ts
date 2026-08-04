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
  /** Whether the process has outlived whatever spawned it. */
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
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    const cmd = raw.replaceAll("\0", " ").trim();
    return cmd.length > 0 ? cmd : undefined;
  } catch {
    return undefined;
  }
}

function psCommandLine(pid: number): string | undefined {
  const out = ps(["-p", String(pid), "-o", "command="]);
  return out === undefined || out.trim().length === 0 ? undefined : out.trim();
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
  const out = ps(["ax", "-o", "pid=,command="]);
  if (out === undefined) return undefined;
  const found: number[] = [];
  for (const line of out.split("\n")) {
    if (!line.includes(fragment)) continue;
    const pid = Number.parseInt(line.trim(), 10);
    if (Number.isInteger(pid) && pid > 0) found.push(pid);
  }
  return found;
}

function parentPid(pid: number): number | undefined {
  // `/proc/<pid>/stat` puts the executable name in parentheses and it may
  // itself contain spaces or parens, so the fixed fields start after the last
  // `)`: state, then ppid.
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat
      .slice(stat.lastIndexOf(")") + 1)
      .trim()
      .split(/\s+/);
    const ppid = Number.parseInt(fields[1] ?? "", 10);
    if (Number.isInteger(ppid)) return ppid;
  } catch {
    /* no procfs — ask ps */
  }
  const out = ps(["-p", String(pid), "-o", "ppid="]);
  if (out === undefined) return undefined;
  const ppid = Number.parseInt(out.trim(), 10);
  return Number.isInteger(ppid) ? ppid : undefined;
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
