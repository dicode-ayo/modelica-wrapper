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
  try {
    return execFileSync("ps", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
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
  return commandLineFromRows(winProcessTable(), pid);
}

function winFindByCommandLine(fragment: string): number[] | undefined {
  return findByCommandLineFromRows(winProcessTable(), fragment);
}

function winParentPid(pid: number): number | undefined {
  return parentPidFromRows(winProcessTable(), pid);
}

/** `undefined` rows means the process table could not be enumerated at all. */
export function commandLineFromRows(
  rows: WinProcessRow[] | undefined,
  pid: number,
): string | undefined {
  return rows?.find((row) => row.pid === pid)?.commandLine;
}

export function findByCommandLineFromRows(
  rows: WinProcessRow[] | undefined,
  fragment: string,
): number[] | undefined {
  if (rows === undefined) return undefined;
  return rows
    .filter((row) => row.commandLine.includes(fragment))
    .map((row) => row.pid);
}

export function parentPidFromRows(
  rows: WinProcessRow[] | undefined,
  pid: number,
): number | undefined {
  return rows?.find((row) => row.pid === pid)?.ppid;
}

/**
 * The whole process table in one shot, so `commandLine`/`findByCommandLine`/
 * `parentPid` each pay for at most one enumeration rather than shelling out
 * per pid. CIM is tried first; `wmic` is deprecated but still present on
 * older hosts CIM cmdlets may not be.
 */
function winProcessTable(): WinProcessRow[] | undefined {
  return winProcessTableViaCim() ?? winProcessTableViaWmic();
}

function winProcessTableViaCim(): WinProcessRow[] | undefined {
  const out = powershell([
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation",
  ]);
  return out === undefined ? undefined : parseCimCsvTable(out);
}

function winProcessTableViaWmic(): WinProcessRow[] | undefined {
  const out = wmic(["process", "get", "ProcessId,ParentProcessId,CommandLine"]);
  return out === undefined ? undefined : parseWmicTable(out);
}

/**
 * Rows of `Get-CimInstance Win32_Process | ... | ConvertTo-Csv -NoTypeInformation`,
 * e.g.:
 *
 * ```
 * "ProcessId","ParentProcessId","CommandLine"
 * "4242","900","C:\Program Files\OpenModelica\bin\omc.exe --interactive=zmq -z=mw_abc"
 * ```
 *
 * `-NoTypeInformation` drops the leading `#TYPE ...` line; the header row
 * above is skipped because "ProcessId" fails the pid/ppid integer parse.
 */
export function parseCimCsvTable(out: string): WinProcessRow[] {
  const rows: WinProcessRow[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const fields = splitCsvLine(line);
    const pid = Number.parseInt(fields[0] ?? "", 10);
    const ppid = Number.parseInt(fields[1] ?? "", 10);
    const commandLine = fields[2];
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    if (commandLine === undefined) continue;
    rows.push({ pid, ppid, commandLine });
  }
  return rows;
}

/** One line of RFC-4180-ish CSV, handling `""`-escaped quotes within quoted fields. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

/**
 * Rows of `wmic process get ProcessId,ParentProcessId,CommandLine`, a
 * whitespace-padded table rather than CSV, e.g.:
 *
 * ```
 * ProcessId  ParentProcessId  CommandLine
 * 4242       900              C:\Program Files\OpenModelica\bin\omc.exe --interactive=zmq -z=mw_abc
 * ```
 *
 * The two leading numeric fields can't contain whitespace, so — as with
 * `parsePsTable` — everything after them to end of line is the command,
 * spacing and all.
 */
export function parseWmicTable(out: string): WinProcessRow[] {
  const rows: WinProcessRow[] = [];
  for (const line of out.split(/\r?\n/)) {
    const fields = /^\s*(\d+)\s+(\d+)\s+(\S.*\S|\S)\s*$/.exec(line);
    const rawPid = fields?.[1];
    const rawPpid = fields?.[2];
    const commandLine = fields?.[3];
    if (
      rawPid === undefined ||
      rawPpid === undefined ||
      commandLine === undefined
    ) {
      continue;
    }
    const pid = Number.parseInt(rawPid, 10);
    const ppid = Number.parseInt(rawPpid, 10);
    if (pid > 0) rows.push({ pid, ppid, commandLine });
  }
  return rows;
}

function powershell(args: string[]): string | undefined {
  try {
    return execFileSync("powershell.exe", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
  } catch {
    return undefined;
  }
}

function wmic(args: string[]): string | undefined {
  try {
    return execFileSync("wmic", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
  } catch {
    return undefined;
  }
}
