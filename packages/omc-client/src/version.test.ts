import { describe, expect, it } from "vitest";

import {
  SUPPORTED_OMC,
  compatibilityReport,
  parseOmcVersion,
} from "./version.js";

describe("parseOmcVersion", () => {
  it.each([
    ["OpenModelica 1.26.1", { major: 1, minor: 26, patch: 1 }],
    ["OpenModelica v1.27.0-dev-184-gabcdef", { major: 1, minor: 27, patch: 0 }],
    ["1.24.0+ds-1", { major: 1, minor: 24, patch: 0 }],
    ["OpenModelica 2.0.0", { major: 2, minor: 0, patch: 0 }],
  ])("parses %s", (raw, want) => {
    const got = parseOmcVersion(raw);
    expect(got).toMatchObject({ ...want, raw });
  });

  it("returns undefined for an unrecognizable string", () => {
    expect(parseOmcVersion("OpenModelica nightly")).toBeUndefined();
    expect(parseOmcVersion("")).toBeUndefined();
  });
});

describe("compatibilityReport", () => {
  it("returns 'exact' for the pinned version", () => {
    const r = compatibilityReport(`OpenModelica ${SUPPORTED_OMC.primary}`);
    expect(r.level).toBe("exact");
  });

  it("returns 'minor-compatible' for the same major.minor", () => {
    const r = compatibilityReport("OpenModelica 1.26.99");
    expect(r.level).toBe("minor-compatible");
  });

  it("returns 'untested' for a different major.minor", () => {
    const r = compatibilityReport("OpenModelica 1.27.0");
    expect(r.level).toBe("untested");
  });

  it("returns 'unparseable' on garbage", () => {
    const r = compatibilityReport("not a version string");
    expect(r.level).toBe("unparseable");
    expect(r.omc).toBeUndefined();
  });

  it("includes the supported primary in every report", () => {
    expect(compatibilityReport("OpenModelica 1.26.1").supportedPrimary).toBe(
      SUPPORTED_OMC.primary,
    );
    expect(compatibilityReport("garbage").supportedPrimary).toBe(
      SUPPORTED_OMC.primary,
    );
  });
});
