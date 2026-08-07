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
   * reparent to, so there the primary signal is that the recorded parent pid
   * is no longer running; a recycled pid still reads as live and spares the
   * session the same way, by a different mechanism. (The implementation also
   * has a `parent <= 1` arm, which is a POSIX-only check — ppid 0/1 mean
   * "init" there but nothing on win32, so it never fires there.)
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

const COMMAND_TIMEOUT_MS = 5_000;
const COMMAND_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

/**
 * `execFileSync` wrapped with this file's degradation contract: any failure
 * — missing binary, non-zero exit, timeout, output past `maxBuffer` — comes
 * back as `undefined` rather than throwing, so callers never have to guess
 * which platform-probing command is safe to leave unguarded. `timeout` and
 * `maxBuffer` are fixed for every call so a wedged binary can't block a reap
 * sweep indefinitely.
 */
function runCommand(cmd: string, args: string[]): string | undefined {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: COMMAND_MAX_BUFFER_BYTES,
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
 * `powershell.exe` per pid within roughly one reap sweep — that command runs
 * synchronously and can cost hundreds of ms. A failed enumeration (`undefined`)
 * is cached too, so a hung or timed-out `powershell.exe` is paid once per
 * sweep rather than once per candidate pid.
 *
 * The TTL is not guaranteed to outlast a sweep — `awaitExit`'s polling plus
 * `QUIT_TIMEOUT_MS` can exceed it — and a cached row can go stale within the
 * TTL if a pid is recycled. Neither matters for safety: nothing here kills a
 * process off a cached row alone. `orphans.ts`'s `stopOmc` re-checks
 * `processes.isRunning(pid)` immediately before `processes.kill(pid)`.
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
  CommandLine?: unknown;
}

function isCimProcess(value: unknown): value is CimProcessJson {
  if (typeof value !== "object" || value === null) return false;
  return (
    "ProcessId" in value &&
    typeof value.ProcessId === "number" &&
    "ParentProcessId" in value &&
    typeof value.ParentProcessId === "number"
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
 * `ConvertTo-Json` collapses a single pipeline object to a bare object rather
 * than a one-element array; the `@(...)` wrapper doesn't change that, since
 * the pipe still unrolls a collection regardless of how the source expression
 * is wrapped. `Get-CimInstance Win32_Process` with no filter always returns
 * the whole table (System Idle Process, services.exe, etc. are always
 * present), so the collapse is not currently reachable here — but the parser
 * below still defends against a non-array top-level value. `CommandLine`
 * comes back `null` for some protected processes; that (and any non-string
 * value) becomes `""` here — `winCommandLine` is what turns `""` into
 * `undefined`.
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
  return runCommand("powershell.exe", args);
}
