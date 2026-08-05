import { describe, expect, it } from "vitest";

import { parsePsTable, ppidFromStat } from "./process-probe.js";

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
