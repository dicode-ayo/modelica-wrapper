import { beforeEach, describe, expect, it } from "vitest";

import { loggedLines } from "../test-support/vscode-mock.js";
import { bounded, log, MAX_LINE_CHARS } from "./logger.js";

describe("log", () => {
  beforeEach(() => {
    loggedLines.length = 0;
    log.dispose();
  });

  it("opens the channel as a LogOutputChannel so the log level is user-settable", () => {
    log.info("topic", "hello");

    expect(loggedLines).toEqual([
      { channel: "Modelica", level: "info", message: "[topic] hello" },
    ]);
  });

  it("routes debug through the channel's debug level, not an env-var gate", () => {
    delete process.env["MODELICA_DEBUG"];

    log.debug("topic", "trace", { a: 1 });

    expect(loggedLines).toEqual([
      { channel: "Modelica", level: "debug", message: '[topic] trace {"a":1}' },
    ]);
  });

  it("maps warn and error onto their own levels, keeping the topic", () => {
    log.warn("t", "careful");
    log.error("t", "boom", new Error("bad"));

    expect(loggedLines.map((l) => l.level)).toEqual(["warn", "error"]);
    expect(loggedLines[1]?.message).toMatch(/^\[t\] boom\nbad\n/);
  });
});

describe("bounded", () => {
  it("passes a line at or under the bound through unchanged", () => {
    const line = "x".repeat(MAX_LINE_CHARS);
    expect(bounded(line)).toBe(line);
  });

  it("keeps the truncated line, suffix included, within the declared bound", () => {
    const line = "x".repeat(MAX_LINE_CHARS + 5000);

    const result = bounded(line);

    expect(result.length).toBeLessThanOrEqual(MAX_LINE_CHARS);
    expect(result).toContain(`${line.length} chars total`);
  });
});
