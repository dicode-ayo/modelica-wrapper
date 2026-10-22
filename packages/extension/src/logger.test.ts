import { beforeEach, describe, expect, it } from "vitest";

import {
  LogLevel,
  loggedLines,
  outputChannelLogLevel,
} from "../test-support/vscode-mock.js";
import { bounded, log, MAX_LINE_CHARS } from "./logger.js";

describe("log", () => {
  beforeEach(() => {
    loggedLines.length = 0;
    outputChannelLogLevel.value = LogLevel.Info;
    log.dispose();
  });

  it("writes info with the topic prefix and no hand-rolled timestamp", () => {
    log.info("topic", "hello");

    expect(loggedLines).toEqual([
      { channel: "Modelica", level: "info", message: "[topic] hello" },
    ]);
  });

  it("writes debug through the channel's debug level once the user enables it", () => {
    outputChannelLogLevel.value = LogLevel.Debug;

    log.debug("topic", "trace", { a: 1 });

    expect(loggedLines).toEqual([
      { channel: "Modelica", level: "debug", message: '[topic] trace {"a":1}' },
    ]);
  });

  it("hides debug at the default level without serialising its payload", () => {
    let serialised = 0;
    const payload = {
      toJSON() {
        serialised += 1;
        return {};
      },
    };

    log.debug("topic", "trace", payload);

    expect(loggedLines).toEqual([]);
    expect(serialised).toBe(0);
  });

  it("maps warn and error onto their own levels, keeping the topic", () => {
    log.warn("t", "careful");
    log.error("t", "boom", new Error("bad"));

    expect(loggedLines.map((l) => l.level)).toEqual(["warn", "error"]);
    expect(loggedLines[1]?.message).toMatch(/^\[t\] boom\nError: bad\n/);
  });

  it("states an error's message once", () => {
    log.error("t", "boom", new Error("bad"));

    expect(loggedLines[0]?.message.match(/bad/g)).toHaveLength(1);
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
