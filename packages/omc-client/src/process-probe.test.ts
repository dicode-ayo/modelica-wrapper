import { describe, expect, it } from "vitest";

import {
  nonEmpty,
  orphanedByParent,
  parseCimJsonTable,
  parsePsTable,
  ppidFromStat,
} from "./process-probe.js";

const noneRunning = (): boolean => false;
const allRunning = (): boolean => true;

describe("orphanedByParent", () => {
  it("reads a parent unreadable as not orphaned, on either platform", () => {
    expect(orphanedByParent(undefined, noneRunning, "linux")).toBe(false);
    expect(orphanedByParent(undefined, noneRunning, "win32")).toBe(false);
  });

  it("reads reparenting to init as orphaned on posix", () => {
    expect(orphanedByParent(1, allRunning, "linux")).toBe(true);
    expect(orphanedByParent(0, allRunning, "linux")).toBe(true);
  });

  it("reads a dead parent as orphaned on either platform", () => {
    expect(orphanedByParent(900, noneRunning, "linux")).toBe(true);
    expect(orphanedByParent(900, noneRunning, "win32")).toBe(true);
  });

  it("reads a live parent as not orphaned on either platform", () => {
    expect(orphanedByParent(900, allRunning, "linux")).toBe(false);
    expect(orphanedByParent(900, allRunning, "win32")).toBe(false);
  });

  it("does not apply the posix init sentinel on win32", () => {
    expect(orphanedByParent(1, allRunning, "win32")).toBe(false);
    expect(orphanedByParent(0, noneRunning, "win32")).toBe(false);
  });
});

describe("ppidFromStat", () => {
  it("reads the parent pid past the executable name", () => {
    expect(ppidFromStat("4242 (omc) S 1 4242 4242 0 -1 4194304")).toBe(1);
  });

  it("reads past an executable name containing spaces and parens", () => {
    expect(ppidFromStat("4242 (a) b) S 900 4242 4242 0 -1")).toBe(900);
  });

  it("reads past an executable name that is only a paren", () => {
    expect(ppidFromStat("4242 ()) S 900 4242")).toBe(900);
  });

  it("reads nothing from a line with no executable name", () => {
    expect(ppidFromStat("4242 S 900")).toBe(undefined);
  });

  it("reads nothing from a truncated line", () => {
    expect(ppidFromStat("4242 (omc) S")).toBe(undefined);
    expect(ppidFromStat("")).toBe(undefined);
  });
});

describe("parsePsTable", () => {
  it("splits pid from command, keeping the command's own spacing", () => {
    const rows = parsePsTable(
      [
        "  4242 omc --interactive=zmq -z=mw_abc",
        " 900 /usr/bin/zsh -c  echo hi",
        "",
      ].join("\n"),
    );

    expect(rows).toEqual([
      { pid: 4242, command: "omc --interactive=zmq -z=mw_abc" },
      { pid: 900, command: "/usr/bin/zsh -c  echo hi" },
    ]);
  });

  it("skips rows with no command and header-ish noise", () => {
    const rows = parsePsTable(["  PID COMMAND", "  4242 ", "4242"].join("\n"));

    expect(rows).toEqual([]);
  });

  it("reads nothing from empty output", () => {
    expect(parsePsTable("")).toEqual([]);
  });
});

describe("parseCimJsonTable", () => {
  it("parses a multi-row Get-CimInstance JSON dump", () => {
    const rows = parseCimJsonTable(
      JSON.stringify([
        {
          ProcessId: 4242,
          ParentProcessId: 900,
          CommandLine:
            "C:\\Program Files\\OpenModelica\\bin\\omc.exe --interactive=zmq -z=mw_abc",
        },
        {
          ProcessId: 900,
          ParentProcessId: 1,
          CommandLine: "C:\\Windows\\System32\\services.exe",
        },
      ]),
    );

    expect(rows).toEqual([
      {
        pid: 4242,
        ppid: 900,
        commandLine:
          "C:\\Program Files\\OpenModelica\\bin\\omc.exe --interactive=zmq -z=mw_abc",
      },
      { pid: 900, ppid: 1, commandLine: "C:\\Windows\\System32\\services.exe" },
    ]);
  });

  it("maps a null or missing CommandLine to an empty string", () => {
    const rows = parseCimJsonTable(
      JSON.stringify([
        { ProcessId: 4242, ParentProcessId: 900, CommandLine: null },
        { ProcessId: 900, ParentProcessId: 1 },
      ]),
    );

    expect(rows).toEqual([
      { pid: 4242, ppid: 900, commandLine: "" },
      { pid: 900, ppid: 1, commandLine: "" },
    ]);
  });

  it("skips pid-0 rows (System Idle Process)", () => {
    const rows = parseCimJsonTable(
      JSON.stringify([{ ProcessId: 0, ParentProcessId: 0, CommandLine: "" }]),
    );

    expect(rows).toEqual([]);
  });

  it("drops entries that fail the process-row guard, keeping well-formed ones", () => {
    const rows = parseCimJsonTable(
      JSON.stringify([
        null,
        "not a process",
        4242,
        { ProcessId: "4242", ParentProcessId: 900, CommandLine: "omc.exe" },
        { ProcessId: 4242.5, ParentProcessId: 900, CommandLine: "omc.exe" },
        { ProcessId: 4242, CommandLine: "omc.exe" },
        { ProcessId: 4242, ParentProcessId: 900, CommandLine: "omc.exe" },
      ]),
    );

    expect(rows).toEqual([{ pid: 4242, ppid: 900, commandLine: "omc.exe" }]);
  });

  it("drops rows whose pid or parent pid is outside the Windows pid range", () => {
    const rows = parseCimJsonTable(
      JSON.stringify([
        { ProcessId: 4242, ParentProcessId: -1, CommandLine: "omc.exe" },
        { ProcessId: -4242, ParentProcessId: 900, CommandLine: "omc.exe" },
        {
          ProcessId: 4242,
          ParentProcessId: 0x1_0000_0000,
          CommandLine: "omc.exe",
        },
        {
          ProcessId: Number.MAX_SAFE_INTEGER + 2,
          ParentProcessId: 900,
          CommandLine: "omc.exe",
        },
        { ProcessId: 4242, ParentProcessId: 0, CommandLine: "omc.exe" },
      ]),
    );

    expect(rows).toEqual([{ pid: 4242, ppid: 0, commandLine: "omc.exe" }]);
  });

  it("reads nothing from a non-array top-level value", () => {
    expect(
      parseCimJsonTable(
        JSON.stringify({
          ProcessId: 4242,
          ParentProcessId: 900,
          CommandLine: "omc.exe",
        }),
      ),
    ).toEqual([]);
  });

  it("reads nothing from malformed JSON", () => {
    expect(parseCimJsonTable("{not json")).toEqual([]);
  });

  it("reads nothing from empty output", () => {
    expect(parseCimJsonTable("")).toEqual([]);
  });
});

describe("nonEmpty", () => {
  it("passes a non-empty table through unchanged", () => {
    const rows = [{ pid: 4242, ppid: 900, commandLine: "omc.exe" }];

    expect(nonEmpty(rows)).toBe(rows);
  });

  it("turns an empty table into undefined, since no real process table is ever empty", () => {
    expect(nonEmpty([])).toBe(undefined);
  });
});
