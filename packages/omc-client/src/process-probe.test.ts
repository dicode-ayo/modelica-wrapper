import { describe, expect, it } from "vitest";

import {
  commandLineFromRows,
  findByCommandLineFromRows,
  parentPidFromRows,
  parseCimCsvTable,
  parsePsTable,
  parseWmicTable,
  ppidFromStat,
} from "./process-probe.js";

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

describe("parseCimCsvTable", () => {
  it("parses a multi-row Get-CimInstance CSV dump", () => {
    const rows = parseCimCsvTable(
      [
        '"ProcessId","ParentProcessId","CommandLine"',
        '"4242","900","C:\\Program Files\\OpenModelica\\bin\\omc.exe --interactive=zmq -z=mw_abc"',
        '"900","1","C:\\Windows\\System32\\services.exe"',
        "",
      ].join("\r\n"),
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

  it("unescapes doubled quotes inside a quoted field, comma and all", () => {
    const rows = parseCimCsvTable(
      '"4242","1","C:\\bin\\omc.exe --title=""mw, omc"" -z=mw_abc"',
    );

    expect(rows).toEqual([
      {
        pid: 4242,
        ppid: 1,
        commandLine: 'C:\\bin\\omc.exe --title="mw, omc" -z=mw_abc',
      },
    ]);
  });

  it("keeps rows whose command line is blank (System Idle Process)", () => {
    const rows = parseCimCsvTable('"0","0",""');

    expect(rows).toEqual([{ pid: 0, ppid: 0, commandLine: "" }]);
  });

  it("reads nothing from empty output", () => {
    expect(parseCimCsvTable("")).toEqual([]);
  });
});

describe("parseWmicTable", () => {
  it("parses a multi-row wmic whitespace table", () => {
    const rows = parseWmicTable(
      [
        "ProcessId  ParentProcessId  CommandLine",
        "4242       900              C:\\Program Files\\OpenModelica\\bin\\omc.exe --interactive=zmq -z=mw_abc",
        "900        1                C:\\Windows\\System32\\services.exe",
        "",
        "",
      ].join("\r\n"),
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

  it("skips rows with no command and header-ish noise", () => {
    const rows = parseWmicTable(
      ["ProcessId  ParentProcessId  CommandLine", "4242       900", ""].join(
        "\r\n",
      ),
    );

    expect(rows).toEqual([]);
  });

  it("reads nothing from empty output", () => {
    expect(parseWmicTable("")).toEqual([]);
  });
});

describe("commandLineFromRows / findByCommandLineFromRows / parentPidFromRows", () => {
  const rows = [
    {
      pid: 4242,
      ppid: 900,
      commandLine: "omc.exe --interactive=zmq -z=mw_abc",
    },
    { pid: 900, ppid: 1, commandLine: "C:\\Windows\\System32\\services.exe" },
  ];

  it("finds a command line by pid", () => {
    expect(commandLineFromRows(rows, 4242)).toBe(
      "omc.exe --interactive=zmq -z=mw_abc",
    );
    expect(commandLineFromRows(rows, 12345)).toBe(undefined);
  });

  it("finds pids whose command line contains a fragment", () => {
    expect(findByCommandLineFromRows(rows, "-z=mw_abc")).toEqual([4242]);
    expect(findByCommandLineFromRows(rows, "-z=nope")).toEqual([]);
  });

  it("finds a parent pid by pid", () => {
    expect(parentPidFromRows(rows, 4242)).toBe(900);
    expect(parentPidFromRows(rows, 12345)).toBe(undefined);
  });

  it("degrades to undefined when the process table could not be enumerated", () => {
    expect(commandLineFromRows(undefined, 4242)).toBe(undefined);
    expect(findByCommandLineFromRows(undefined, "-z=mw_abc")).toBe(undefined);
    expect(parentPidFromRows(undefined, 4242)).toBe(undefined);
  });
});
