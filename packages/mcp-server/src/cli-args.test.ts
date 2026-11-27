import { describe, expect, it } from "vitest";

import { parseCliArgs } from "./cli-args.js";

describe("modelica-mcp arguments", () => {
  it("serves the current directory when no root is given", () => {
    expect(parseCliArgs([], "/work/project")).toEqual({
      kind: "serve",
      root: "/work/project",
    });
  });

  it("resolves a relative --root against the current directory", () => {
    expect(parseCliArgs(["--root", "models"], "/work")).toEqual({
      kind: "serve",
      root: "/work/models",
    });
    expect(parseCliArgs(["--root=/abs/tree"], "/work")).toEqual({
      kind: "serve",
      root: "/abs/tree",
    });
  });

  it("answers help before anything else", () => {
    expect(parseCliArgs(["--root", "x", "-h"], "/work")).toEqual({
      kind: "help",
    });
  });

  it("rejects an option it does not know rather than ignoring it", () => {
    expect(parseCliArgs(["--http"], "/work")).toMatchObject({
      kind: "invalid",
      message: expect.stringContaining("--http"),
    });
  });

  it("rejects a positional argument and a --root with no value", () => {
    expect(parseCliArgs(["models"], "/work")).toMatchObject({
      kind: "invalid",
    });
    expect(parseCliArgs(["--root"], "/work")).toMatchObject({
      kind: "invalid",
    });
  });
});
