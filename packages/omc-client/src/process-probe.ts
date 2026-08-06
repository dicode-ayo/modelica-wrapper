/**
 * The reaper's window onto the OS process table.
 *
 * Every method answers "cannot tell" as `undefined` rather than guessing, so
 * a platform without procfs and without `ps` — or, on win32, a host where
 * CIM cannot be queried — degrades to leaving sessions alone instead of
 * signalling processes it has not identified.
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
   * sparing a session — never to signalling one. Windows has no init to
   * reparent to, so there the only signal is that the recorded parent pid is
   * no longer running; a recycled pid still reads as live and spares the
   * session the same way, by a different mechanism.
   */
  isOrphan(pid: number): boolean;
  kill(pid: number): void;
}

export const osProcesses: ProcessProbe = {
  isRunning,
  commandLine(pid) {
    return process.platform === "win32"
      ? winCommandLine(pid)
      : (procfsCommandLine(pid) ?? psCommandLine(pid));
  },
  findByCommandLine(fragment) {
    return process.platform === "win32"
      ? winFindByCommandLine(fragment)
      : (procfsScan(fragment) ?? psScan(fragment));
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
  if (process.platform === "win32") return winParentPid(pid);
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
  return runCommand("ps", args);
}

/**
 * `execFileSync` wrapped with this file's degradation contract: any failure
 * — missing binary, non-zero exit, timeout, output past `maxBuffer` — comes
 * back as `undefined` rather than throwing, so callers never have to guess
 * which platform-probing command is safe to leave unguarded.
 */
function runCommand(
  cmd: string,
  args: string[],
  opts: { timeout?: number; maxBuffer?: number } = {},
): string | undefined {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      ...opts,
    });
  } catch {
    return undefined;
  }
}

/** One row of the Windows process table, keyed the same way `/proc` is. */
export interface WinProcessRow {
  pid: number;
  ppid: number;
  commandLine: string;
}

function winCommandLine(pid: number): string | undefined {
  const commandLine = winProcessTable()?.find(
    (row) => row.pid === pid,
  )?.commandLine;
  // Mirrors procfsCommandLine: an empty command line reads as "could not be
  // read" (e.g. CIM reporting `null` for a protected process), not as a real,
  // empty value — otherwise identifyOmc treats it as a definite non-match.
  return commandLine !== undefined && commandLine.length > 0
    ? commandLine
    : undefined;
}

function winFindByCommandLine(fragment: string): number[] | undefined {
  return winProcessTable()
    ?.filter((row) => row.commandLine.includes(fragment))
    .map((row) => row.pid);
}

function winParentPid(pid: number): number | undefined {
  return winProcessTable()?.find((row) => row.pid === pid)?.ppid;
}

const PROCESS_TABLE_CACHE_TTL_MS = 5_000;

let processTableCache:
  | { rows: WinProcessRow[] | undefined; expiresAt: number }
  | undefined;

/**
 * The whole process table in one shot, cached for `PROCESS_TABLE_CACHE_TTL_MS`
 * so `commandLine`/`findByCommandLine`/`parentPid` don't each shell out to
 * `powershell.exe` per pid within the same reap sweep — that command runs
 * synchronously and can cost hundreds of ms. Five seconds is far shorter than
 * any realistic pid-recycling window, so a cached row is never stale enough
 * to misidentify a process, and comfortably longer than one sweep, so it
 * still collapses the repeated calls a single sweep makes.
 */
function winProcessTable(): WinProcessRow[] | undefined {
  const now = Date.now();
  if (processTableCache !== undefined && now < processTableCache.expiresAt) {
    return processTableCache.rows;
  }
  const rows = winProcessTableViaCim();
  processTableCache = { rows, expiresAt: now + PROCESS_TABLE_CACHE_TTL_MS };
  return rows;
}

function winProcessTableViaCim(): WinProcessRow[] | undefined {
  const out = powershell([
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine) | ConvertTo-Json -Compress",
  ]);
  return out === undefined ? undefined : nonEmpty(parseCimJsonTable(out));
}

/**
 * No real Windows process table is ever empty — the querying process itself
 * is always in it — so a zero-row parse (an unexpected locale header, a WMI
 * hiccup, garbled output that still exits 0) means "could not enumerate",
 * same as a failed `execFileSync`, not "the table has zero processes".
 */
export function nonEmpty(rows: WinProcessRow[]): WinProcessRow[] | undefined {
  return rows.length > 0 ? rows : undefined;
}

interface CimProcessJson {
  ProcessId: number;
  ParentProcessId: number;
  CommandLine: unknown;
}

function isCimProcess(value: unknown): value is CimProcessJson {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.ProcessId === "number" &&
    typeof record.ParentProcessId === "number"
  );
}

/**
 * Rows of
 * `@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine) | ConvertTo-Json -Compress`,
 * e.g.:
 *
 * ```
 * [{"ProcessId":4242,"ParentProcessId":900,"CommandLine":"C:\\Program Files\\OpenModelica\\bin\\omc.exe --interactive=zmq -z=mw_abc"}]
 * ```
 *
 * The `@(...)` wrapper makes `ConvertTo-Json` emit an array even for a single
 * process, which it otherwise collapses to a bare object. `CommandLine` comes
 * back `null` for some protected processes; that (and any non-string value)
 * becomes `""` here — `winCommandLine` is what turns `""` into `undefined`.
 */
export function parseCimJsonTable(out: string): WinProcessRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const rows: WinProcessRow[] = [];
  for (const entry of parsed) {
    if (!isCimProcess(entry)) continue;
    const { ProcessId: pid, ParentProcessId: ppid } = entry;
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || pid <= 0) {
      continue;
    }
    const commandLine =
      typeof entry.CommandLine === "string" ? entry.CommandLine : "";
    rows.push({ pid, ppid, commandLine });
  }
  return rows;
}

function powershell(args: string[]): string | undefined {
  return runCommand("powershell.exe", args, {
    timeout: 5_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}
