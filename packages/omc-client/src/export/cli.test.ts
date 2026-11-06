import { describe, expect, it } from "vitest";

import { parseCliArgs } from "./cli.js";

describe("parseCliArgs", () => {
  it("reads --out and the packages, skipping pnpm's leading --", () => {
    expect(parseCliArgs(["--", "--out", "d", "Modelica"])).toEqual({
      out: "d",
      packages: ["Modelica"],
    });
  });

  it("rejects an unknown flag instead of treating it as a package", () => {
    expect(() => parseCliArgs(["--out", "d", "--foo", "P"])).toThrow();
  });

  it("rejects --out without a value", () => {
    expect(() => parseCliArgs(["--out"])).toThrow();
  });

  it("requires at least one package", () => {
    expect(() => parseCliArgs(["--out", "d"])).toThrow(/usage/);
  });
});
